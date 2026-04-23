// services/compOffService.js
const supabase = require('../config/supabase');

class CompOffService {
    
    /**
     * Check if a date is a holiday
     */

    static async isHoliday(date) {
        try {
            const dateStr = date.toISOString().split('T')[0];
            
            // You can implement this based on your holiday data source
            // For now, we'll assume holidays are stored in a table or config
            const { data, error } = await supabase
                .from('holidays')
                .select('*')
                .eq('holiday_date', dateStr)
                .maybeSingle();

            if (error) throw error;
            
            return data || null;
        } catch (error) {
            console.error('Error checking holiday:', error);
            return null;
        }
    }

    /**
     * Check if employee worked on a holiday
     */

    static async checkHolidayWork(employee_id, date, total_hours) {
        try {
            const holiday = await this.isHoliday(date);
            
            if (!holiday) return null; // Not a holiday
            
            // Check if worked full day (8+ hours)
            if (total_hours >= 8) {
                return await this.earnCompOff(employee_id, date, holiday.name, total_hours);
            }
            
            return null;
        } catch (error) {
            console.error('Error checking holiday work:', error);
            return null;
        }
    }

    /**
     * Earn comp-off for working on holiday
     */

    static async earnCompOff(employee_id, holiday_date, holiday_name, worked_hours) {
        try {
            const date = new Date(holiday_date);
            const expiryDate = new Date(date);
            expiryDate.setMonth(expiryDate.getMonth() + 3); // Valid for 3 months
            
            // Check if already earned comp-off for this holiday
            const { data: existing, error: checkError } = await supabase
                .from('comp_off')
                .select('*')
                .eq('employee_id', employee_id)
                .eq('holiday_date', holiday_date.toISOString().split('T')[0]);

            if (checkError) throw checkError;

            if (existing && existing.length > 0) {
                return existing[0];
            }

            // Insert comp-off record
            const { data, error } = await supabase
                .from('comp_off')
                .insert([{
                    employee_id,
                    holiday_date: holiday_date.toISOString().split('T')[0],
                    holiday_name,
                    worked_hours,
                    status: 'earned',
                    earned_date: new Date().toISOString().split('T')[0],
                    expiry_date: expiryDate.toISOString().split('T')[0]
                }])
                .select();

            if (error) throw error;

            // Update leave balance
            const currentYear = new Date().getFullYear();
            
            // Get current balance
            const { data: balance, error: balError } = await supabase
                .from('leave_balance')
                .select('*')
                .eq('employee_id', employee_id)
                .eq('leave_year', currentYear)
                .single();

            if (balError && balError.code !== 'PGRST116') throw balError;

            if (balance) {
                // Update existing balance
                await supabase
                    .from('leave_balance')
                    .update({
                        comp_off_balance: (balance.comp_off_balance || 0) + 1,
                        updated_at: new Date().toISOString()
                    })
                    .eq('employee_id', employee_id)
                    .eq('leave_year', currentYear);
            } else {
                // Create new balance
                await supabase
                    .from('leave_balance')
                    .insert([{
                        employee_id,
                        leave_year: currentYear,
                        comp_off_balance: 1,
                        comp_off_used: 0,
                        comp_off_expired: 0,
                        total_accrued: 0,
                        current_balance: 0
                    }]);
            }

            // Create notification
            await supabase
                .from('notifications')
                .insert([{
                    employee_id,
                    title: 'Comp-Off Earned',
                    message: `You have earned 1 Comp-Off day for working on ${holiday_name}. Valid until ${expiryDate.toLocaleDateString()}.`,
                    type: 'comp_off_earned',
                    created_at: new Date().toISOString()
                }]);

            return data[0];
        } catch (error) {
            console.error('Error earning comp-off:', error);
            throw error;
        }
    }

    /**
     * Get comp-off balance for employee
     */

    static async getCompOffBalance(employee_id) {
        try {
            const currentYear = new Date().getFullYear();
            
            const { data: balance, error } = await supabase
                .from('leave_balance')
                .select('comp_off_balance, comp_off_used, comp_off_expired')
                .eq('employee_id', employee_id)
                .eq('leave_year', currentYear)
                .maybeSingle();

            if (error) throw error;

            if (!balance) {
                return {
                    available: 0,
                    used: 0,
                    expired: 0,
                    total: 0
                };
            }

            return {
                available: balance.comp_off_balance || 0,
                used: balance.comp_off_used || 0,
                expired: balance.comp_off_expired || 0,
                total: (balance.comp_off_balance || 0) + (balance.comp_off_used || 0) + (balance.comp_off_expired || 0)
            };
        } catch (error) {
            console.error('Error getting comp-off balance:', error);
            return {
                available: 0,
                used: 0,
                expired: 0,
                total: 0
            };
        }
    }

    /**
     * Get available comp-off leaves
     */

    static async getAvailableCompOffs(employee_id) {
        try {
            const today = new Date().toISOString().split('T')[0];
            
            const { data, error } = await supabase
                .from('comp_off')
                .select('*')
                .eq('employee_id', employee_id)
                .eq('status', 'earned')
                .gte('expiry_date', today)
                .order('expiry_date', { ascending: true });

            if (error) throw error;

            return data || [];
        } catch (error) {
            console.error('Error getting available comp-offs:', error);
            return [];
        }
    }

    /**
     * Use comp-off for leave
     */

    static async useCompOff(employee_id, leaveId, days = 1) {
        try {
            const available = await this.getAvailableCompOffs(employee_id);
            
            if (available.length < days) {
                throw new Error('Insufficient comp-off balance');
            }

            const toUse = available.slice(0, days);
            const currentYear = new Date().getFullYear();

            // Update each comp-off record
            for (const comp of toUse) {
                await supabase
                    .from('comp_off')
                    .update({
                        status: 'used',
                        used_date: new Date().toISOString().split('T')[0],
                        leave_id: leaveId
                    })
                    .eq('id', comp.id);
            }

            // Update leave balance
            const { data: balance, error: balError } = await supabase
                .from('leave_balance')
                .select('*')
                .eq('employee_id', employee_id)
                .eq('leave_year', currentYear)
                .single();

            if (balError) throw balError;

            await supabase
                .from('leave_balance')
                .update({
                    comp_off_balance: (balance.comp_off_balance || 0) - days,
                    comp_off_used: (balance.comp_off_used || 0) + days
                })
                .eq('employee_id', employee_id)
                .eq('leave_year', currentYear);

            return toUse;
        } catch (error) {
            console.error('Error using comp-off:', error);
            throw error;
        }
    }

    /**
     * Check and expire comp-offs
     */
    
    static async expireCompOffs() {
        try {
            const today = new Date().toISOString().split('T')[0];
            
            const { data: expired, error } = await supabase
                .from('comp_off')
                .select('*')
                .eq('status', 'earned')
                .lt('expiry_date', today);

            if (error) throw error;

            if (!expired || expired.length === 0) return { expired: 0 };

            // Group by employee
            const byEmployee = {};
            expired.forEach(comp => {
                if (!byEmployee[comp.employee_id]) {
                    byEmployee[comp.employee_id] = 0;
                }
                byEmployee[comp.employee_id]++;
            });

            // Update status
            await supabase
                .from('comp_off')
                .update({ status: 'expired' })
                .eq('status', 'earned')
                .lt('expiry_date', today);

            // Update balances
            for (const [empId, count] of Object.entries(byEmployee)) {
                const currentYear = new Date().getFullYear();
                
                const { data: balance } = await supabase
                    .from('leave_balance')
                    .select('*')
                    .eq('employee_id', empId)
                    .eq('leave_year', currentYear)
                    .single();

                if (balance) {
                    await supabase
                        .from('leave_balance')
                        .update({
                            comp_off_balance: (balance.comp_off_balance || 0) - count,
                            comp_off_expired: (balance.comp_off_expired || 0) + count
                        })
                        .eq('employee_id', empId)
                        .eq('leave_year', currentYear);
                }
            }

            return { expired: expired.length };
        } catch (error) {
            console.error('Error expiring comp-offs:', error);
            return { expired: 0 };
        }
    }
}

module.exports = CompOffService;