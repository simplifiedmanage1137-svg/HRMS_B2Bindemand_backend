// services/compOffService.js
const supabase = require('../config/supabase');
const { holidays } = require('../data/holidays');

const COMP_OFF_EXPIRY_DAYS = 45;

class CompOffService {

    /**
     * Check if a date is a holiday using frontend calendar dates
     */
    static isHolidayDate(dateStr) {
        const holiday = holidays.find(h => h.date === dateStr);
        if (holiday) {
            return { name: holiday.name };
        }
        return null;
    }

    /**
     * Get expiry date: holiday_date + 45 days
     */
    static getExpiryDate(holidayDateStr) {
        const d = new Date(holidayDateStr);
        d.setDate(d.getDate() + COMP_OFF_EXPIRY_DAYS);
        return d.toISOString().split('T')[0];
    }

    /**
     * Check if employee worked on a holiday and award comp-off if 9+ hours
     * Only uses frontend calendar dates — weekends and non-calendar dates are excluded
     */
    static async checkHolidayWork(employee_id, date, total_hours) {
        try {
            const dateStr = typeof date === 'string' ? date.split('T')[0] : date.toISOString().split('T')[0];

            // Only award comp-off for dates in the frontend holiday calendar
            const holiday = this.isHolidayDate(dateStr);
            if (!holiday) return null;

            if (total_hours >= 9) {
                return await this.earnCompOff(employee_id, dateStr, holiday.name, total_hours);
            }

            return null;
        } catch (error) {
            console.error('Error checking holiday work:', error);
            return null;
        }
    }

    /**
     * Earn comp-off for working on holiday
     * Uses comp_off_earnings table (actual DB table)
     * Expiry is tracked via created_at + 45 days (since no expiry_date column)
     */
    static async earnCompOff(employee_id, holiday_date, holiday_name, worked_hours) {
        try {
            const dateStr = typeof holiday_date === 'string' ? holiday_date.split('T')[0] : holiday_date.toISOString().split('T')[0];

            // Check if already earned comp-off for this holiday
            const { data: existing, error: checkError } = await supabase
                .from('comp_off_earnings')
                .select('id')
                .eq('employee_id', employee_id)
                .eq('attendance_date', dateStr);

            if (checkError) throw checkError;

            if (existing && existing.length > 0) {
                return existing[0]; // Already awarded
            }

            // Insert comp-off record
            const { data, error } = await supabase
                .from('comp_off_earnings')
                .insert([{
                    employee_id,
                    attendance_date: dateStr,
                    holiday_date: dateStr,
                    holiday_name,
                    hours_worked: worked_hours,
                    comp_off_days: 1,
                    is_used: false
                }])
                .select();

            if (error) throw error;

            // Update employees.comp_off_balance
            const { data: emp } = await supabase
                .from('employees')
                .select('comp_off_balance')
                .eq('employee_id', employee_id)
                .single();

            await supabase
                .from('employees')
                .update({ comp_off_balance: (emp?.comp_off_balance || 0) + 1 })
                .eq('employee_id', employee_id);

            // Create notification
            const expiryDate = this.getExpiryDate(dateStr);
            await supabase
                .from('notifications')
                .insert([{
                    employee_id,
                    title: 'Comp-Off Earned',
                    message: `You have earned 1 Comp-Off day for working on ${holiday_name} (${dateStr}). Valid until ${expiryDate}.`,
                    type: 'comp_off_earned',
                    created_at: new Date().toISOString()
                }]);

            console.log(`✅ Comp-Off earned: ${employee_id} for ${holiday_name} on ${dateStr}, expires ${expiryDate}`);
            return data[0];
        } catch (error) {
            console.error('Error earning comp-off:', error);
            throw error;
        }
    }

    /**
     * Get available (non-expired, non-used) comp-offs for employee
     * Expiry = attendance_date + 45 days
     */
    static async getAvailableCompOffs(employee_id) {
        try {
            const today = new Date().toISOString().split('T')[0];

            const { data, error } = await supabase
                .from('comp_off_earnings')
                .select('*')
                .eq('employee_id', employee_id)
                .eq('is_used', false)
                .order('attendance_date', { ascending: true });

            if (error) throw error;

            // Filter: only those within 45 days of holiday date
            return (data || []).filter(c => {
                const expiry = this.getExpiryDate(c.attendance_date);
                return expiry >= today;
            });
        } catch (error) {
            console.error('Error getting available comp-offs:', error);
            return [];
        }
    }

    /**
     * Get actual valid comp-off count (for balance display)
     */
    static async getValidCompOffCount(employee_id) {
        const available = await this.getAvailableCompOffs(employee_id);
        return available.length;
    }

    /**
     * Mark comp-off as used when leave is applied
     */
    static async useCompOff(employee_id, leaveId, days = 1) {
        try {
            const available = await this.getAvailableCompOffs(employee_id);

            if (available.length < days) {
                throw new Error('Insufficient comp-off balance');
            }

            const toUse = available.slice(0, days);

            for (const comp of toUse) {
                await supabase
                    .from('comp_off_earnings')
                    .update({
                        is_used: true,
                        used_on: new Date().toISOString().split('T')[0],
                        used_for_leave_id: leaveId
                    })
                    .eq('id', comp.id);
            }

            // Update employees.comp_off_balance
            const { data: emp } = await supabase
                .from('employees')
                .select('comp_off_balance')
                .eq('employee_id', employee_id)
                .single();

            await supabase
                .from('employees')
                .update({ comp_off_balance: Math.max(0, (emp?.comp_off_balance || 0) - days) })
                .eq('employee_id', employee_id);

            return toUse;
        } catch (error) {
            console.error('Error using comp-off:', error);
            throw error;
        }
    }

    /**
     * Expire comp-offs older than 45 days (called by cron)
     * Since no expiry_date column, we calculate from attendance_date
     */
    static async expireCompOffs() {
        try {
            const today = new Date().toISOString().split('T')[0];

            // Get all unused comp-offs
            const { data: unused, error } = await supabase
                .from('comp_off_earnings')
                .select('*')
                .eq('is_used', false);

            if (error) throw error;

            // Find expired ones (attendance_date + 45 days < today)
            const expired = (unused || []).filter(c => {
                const expiry = this.getExpiryDate(c.attendance_date);
                return expiry < today;
            });

            if (expired.length === 0) return { expired: 0 };

            // Group by employee
            const byEmployee = {};
            expired.forEach(c => {
                byEmployee[c.employee_id] = (byEmployee[c.employee_id] || 0) + 1;
            });

            // Mark as used (expired) - we use is_used=true with used_on as marker
            for (const comp of expired) {
                await supabase
                    .from('comp_off_earnings')
                    .update({ is_used: true, used_on: today })
                    .eq('id', comp.id);
            }

            // Update employees.comp_off_balance
            for (const [empId, count] of Object.entries(byEmployee)) {
                const { data: emp } = await supabase
                    .from('employees')
                    .select('comp_off_balance')
                    .eq('employee_id', empId)
                    .single();

                if (emp) {
                    await supabase
                        .from('employees')
                        .update({ comp_off_balance: Math.max(0, (emp.comp_off_balance || 0) - count) })
                        .eq('employee_id', empId);
                }
            }

            console.log(`✅ Expired ${expired.length} comp-off records`);
            return { expired: expired.length };
        } catch (error) {
            console.error('Error expiring comp-offs:', error);
            return { expired: 0 };
        }
    }
}

module.exports = CompOffService;
