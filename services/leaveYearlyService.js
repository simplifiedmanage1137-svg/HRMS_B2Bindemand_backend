const supabase = require('../config/supabase');

class LeaveYearlyService {
    
    /**
     * Check if today is the last day of the month (for cron job)
     */

    static isLastDayOfMonth(date = new Date()) {
        const tomorrow = new Date(date);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.getDate() === 1;
    }

    /**
     * Get the last day of a given month
     */

    static getLastDayOfMonth(year, month) {
        return new Date(year, month + 1, 0).getDate();
    }

    static calculateCompletedMonthsFromJoining(joiningDate, currentDate = new Date()) {
        const join = new Date(joiningDate);
        const today = new Date(currentDate);

        if (today < join) return 0;

        let totalMonths = (today.getFullYear() - join.getFullYear()) * 12 +
            (today.getMonth() - join.getMonth());

        // Only count current month if today is AFTER the joining day OR it's the last day
        if (today.getDate() >= join.getDate() || this.isLastDayOfMonth(today)) {
            // Don't add current month until month is complete
            // Month is complete only if we're in the next month
        } else {
            totalMonths = Math.max(0, totalMonths - 1);
        }

        return totalMonths;
    }

    /**
     * Get months that should be accrued (completed months after probation)
     */

    static getMonthsToAccrue(joiningDate, currentDate = new Date()) {
        const join = new Date(joiningDate);
        const today = new Date(currentDate);
        
        // Calculate completed months since joining
        let completedMonths = (today.getFullYear() - join.getFullYear()) * 12 +
                              (today.getMonth() - join.getMonth());
        
        // Adjust for day of month - only count month if it's complete
        if (today.getDate() < join.getDate() && !this.isLastDayOfMonth(today)) {
            completedMonths = Math.max(0, completedMonths - 1);
        }
        
        // Only count months AFTER probation (6 months)
        if (completedMonths <= 6) {
            return [];
        }
        
        const monthsAfterProbation = completedMonths - 6;
        const monthsToAccrue = [];
        
        // Calculate which months should be accrued
        for (let i = 0; i < monthsAfterProbation; i++) {
            const accrualDate = new Date(join);
            accrualDate.setMonth(join.getMonth() + 6 + i);
            
            // Only accrue if month is complete (we're past its last day)
            const lastDayOfAccrualMonth = new Date(accrualDate.getFullYear(), accrualDate.getMonth() + 1, 0);
            if (today > lastDayOfAccrualMonth || 
                (today.getFullYear() === lastDayOfAccrualMonth.getFullYear() &&
                 today.getMonth() === lastDayOfAccrualMonth.getMonth() &&
                 this.isLastDayOfMonth(today))) {
                monthsToAccrue.push({
                    year: accrualDate.getFullYear(),
                    month: accrualDate.getMonth() + 1,
                    monthName: accrualDate.toLocaleString('default', { month: 'long' })
                });
            }
        }
        
        return monthsToAccrue;
    }

    /**
     * Reset leave balance for new year (run on Jan 1st)
     */

    static async resetForNewYear() {
        try {
            const today = new Date();
            const currentYear = today.getFullYear();
            const newYear = currentYear + 1;
            
            console.log('='.repeat(70));
            console.log(`🔄 YEAR-END LEAVE RESET FOR YEAR ${currentYear}`);
            console.log('='.repeat(70));
            
            // Get all active employees
            const { data: employees, error: empError } = await supabase
                .from('employees')
                .select('employee_id, joining_date, first_name, last_name')
                .eq('employee_status', 'Active');
            
            if (empError) throw empError;
            
            const results = {
                total: employees?.length || 0,
                reset: 0,
                created: 0,
                failed: 0
            };
            
            for (const emp of employees || []) {
                try {
                    // Archive current year's balance
                    const { data: currentBalance, error: fetchError } = await supabase
                        .from('leave_balance')
                        .select('*')
                        .eq('employee_id', emp.employee_id)
                        .eq('leave_year', currentYear)
                        .maybeSingle();
                    
                    if (currentBalance) {
                        // Archive to leave_balance_archive table
                        await supabase
                            .from('leave_balance_archive')
                            .insert([{
                                ...currentBalance,
                                archived_date: today.toISOString(),
                                carried_over: currentBalance.current_balance
                            }]);
                        
                        // Delete current balance
                        await supabase
                            .from('leave_balance')
                            .delete()
                            .eq('employee_id', emp.employee_id)
                            .eq('leave_year', currentYear);
                        
                        results.reset++;
                    }
                    
                    // Create new balance for next year (starting from 0)
                    const joiningDate = new Date(emp.joining_date);
                    const monthsCompleted = this.calculateCompletedMonthsFromJoining(joiningDate, new Date(newYear, 0, 1));
                    
                    let initialAccrued = 0;
                    if (monthsCompleted >= 6) {
                        const monthsAfterProbation = monthsCompleted - 6;
                        initialAccrued = monthsAfterProbation * 1.5;
                    }
                    
                    await supabase
                        .from('leave_balance')
                        .insert([{
                            employee_id: emp.employee_id,
                            leave_year: newYear,
                            total_accrued: initialAccrued,
                            total_used: 0,
                            total_pending: 0,
                            current_balance: initialAccrued,
                            last_updated: today.toISOString()
                        }]);
                    
                    results.created++;
                    console.log(`✅ ${emp.employee_id}: Reset for ${newYear}, Initial accrual: ${initialAccrued}`);
                    
                } catch (empError) {
                    results.failed++;
                    console.error(`❌ Error resetting ${emp.employee_id}:`, empError.message);
                }
            }
            
            console.log('='.repeat(70));
            console.log('📊 YEAR-END RESET SUMMARY');
            console.log(`Total: ${results.total}`);
            console.log(`Reset: ${results.reset}`);
            console.log(`Created: ${results.created}`);
            console.log(`Failed: ${results.failed}`);
            console.log('='.repeat(70));
            
            return { success: true, results };
            
        } catch (error) {
            console.error('❌ Error in year-end reset:', error);
            throw error;
        }
    }

    /**
     * Add monthly accrual for all eligible employees (run on last day of month)
     */
    
    static async addMonthlyAccrual() {
        try {
            const today = new Date();
            
            // Only run on last day of month
            if (!this.isLastDayOfMonth(today)) {
                return {
                    success: false,
                    message: `Accrual only runs on last day of month. Today: ${today.toDateString()}`
                };
            }
            
            const currentYear = today.getFullYear();
            const currentMonth = today.getMonth();
            const monthName = today.toLocaleString('default', { month: 'long' });
            
            console.log('='.repeat(70));
            console.log(`🔄 MONTHLY LEAVE ACCRUAL - ${monthName} ${currentYear}`);
            console.log(`📅 Today is last day of month: ${today.toDateString()}`);
            console.log('='.repeat(70));
            
            // Get all active employees
            const { data: employees, error: empError } = await supabase
                .from('employees')
                .select('employee_id, joining_date, first_name, last_name')
                .eq('employee_status', 'Active');
            
            if (empError) throw empError;
            
            const results = {
                total: employees?.length || 0,
                successful: 0,
                skipped: 0,
                failed: 0,
                details: []
            };
            
            for (const emp of employees || []) {
                try {
                    const joiningDate = new Date(emp.joining_date);
                    const monthsCompleted = this.calculateCompletedMonthsFromJoining(joiningDate, today);
                    
                    // Only accrue if employee has completed probation (6 months)
                    if (monthsCompleted < 6) {
                        results.skipped++;
                        results.details.push({
                            employee_id: emp.employee_id,
                            name: `${emp.first_name} ${emp.last_name}`,
                            status: 'skipped',
                            reason: `Still in probation (${monthsCompleted}/6 months)`
                        });
                        continue;
                    }
                    
                    // Check if already accrued this month
                    const { data: existingAccrual, error: checkError } = await supabase
                        .from('leave_transactions')
                        .select('id')
                        .eq('employee_id', emp.employee_id)
                        .eq('transaction_type', 'accrual')
                        .eq('transaction_month', currentMonth + 1)
                        .eq('leave_year', currentYear);
                    
                    if (checkError) throw checkError;
                    
                    if (existingAccrual && existingAccrual.length > 0) {
                        results.skipped++;
                        results.details.push({
                            employee_id: emp.employee_id,
                            name: `${emp.first_name} ${emp.last_name}`,
                            status: 'skipped',
                            reason: `Already accrued for ${monthName}`
                        });
                        continue;
                    }
                    
                    // Get current balance
                    const { data: balance, error: balanceError } = await supabase
                        .from('leave_balance')
                        .select('*')
                        .eq('employee_id', emp.employee_id)
                        .eq('leave_year', currentYear)
                        .maybeSingle();
                    
                    if (balanceError) throw balanceError;
                    
                    const accrualAmount = 1.5;
                    
                    if (!balance) {
                        // Create new balance
                        await supabase
                            .from('leave_balance')
                            .insert([{
                                employee_id: emp.employee_id,
                                leave_year: currentYear,
                                total_accrued: accrualAmount,
                                total_used: 0,
                                total_pending: 0,
                                current_balance: accrualAmount,
                                last_updated: today.toISOString()
                            }]);
                    } else {
                        // Update existing balance
                        const newAccrued = (parseFloat(balance.total_accrued) || 0) + accrualAmount;
                        const newCurrent = (parseFloat(balance.current_balance) || 0) + accrualAmount;
                        
                        await supabase
                            .from('leave_balance')
                            .update({
                                total_accrued: newAccrued,
                                current_balance: newCurrent,
                                last_updated: today.toISOString()
                            })
                            .eq('employee_id', emp.employee_id)
                            .eq('leave_year', currentYear);
                    }
                    
                    // Record transaction
                    await supabase
                        .from('leave_transactions')
                        .insert([{
                            employee_id: emp.employee_id,
                            leave_year: currentYear,
                            transaction_month: currentMonth + 1,
                            transaction_date: today.toISOString().split('T')[0],
                            transaction_type: 'accrual',
                            amount: accrualAmount,
                            description: `Monthly leave accrual for ${monthName} ${currentYear}`
                        }]);
                    
                    results.successful++;
                    results.details.push({
                        employee_id: emp.employee_id,
                        name: `${emp.first_name} ${emp.last_name}`,
                        status: 'success',
                        amount: accrualAmount,
                        month: monthName
                    });
                    
                    console.log(`✅ ${emp.employee_id}: Added ${accrualAmount} leaves for ${monthName}`);
                    
                    // Small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 50));
                    
                } catch (empError) {
                    results.failed++;
                    results.details.push({
                        employee_id: emp.employee_id,
                        name: `${emp.first_name} ${emp.last_name}`,
                        status: 'failed',
                        error: empError.message
                    });
                    console.error(`❌ Error for ${emp.employee_id}:`, empError.message);
                }
            }
            
            console.log('='.repeat(70));
            console.log('📊 ACCRUAL SUMMARY');
            console.log(`Month: ${monthName} ${currentYear}`);
            console.log(`Total eligible: ${results.total}`);
            console.log(`Successful: ${results.successful}`);
            console.log(`Skipped: ${results.skipped}`);
            console.log(`Failed: ${results.failed}`);
            console.log('='.repeat(70));
            
            return {
                success: true,
                message: `Monthly accrual for ${monthName} ${currentYear} completed`,
                summary: results
            };
            
        } catch (error) {
            console.error('❌ Error in monthly accrual:', error);
            throw error;
        }
    }
}

module.exports = LeaveYearlyService;