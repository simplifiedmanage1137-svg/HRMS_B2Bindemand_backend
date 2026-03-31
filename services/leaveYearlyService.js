// services/leaveYearlyService.js
const supabase = require('../config/supabase');

class LeaveYearlyService {
    
    // Check if accrual should happen for current month
    static shouldAccrueCurrentMonth() {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const currentDate = now.getDate();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        
        const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const isLastDay = currentDate === lastDayOfMonth;
        
        // Only accrue if it's last day AND time is 23:59 or later
        // OR if we're already in next month
        const isAfter11_59PM = (currentHour === 23 && currentMinute >= 59) || currentHour >= 0;
        
        if (isLastDay && isAfter11_59PM) {
            return true;
        }
        
        // If we're in next month (e.g., April 1st), we should have accrued for March already
        if (currentDate === 1 && currentHour >= 0) {
            return true;
        }
        
        return false;
    }

    // Calculate months from joining date (only completed months)
    static calculateCompletedMonthsFromJoining(joiningDate, currentDate = new Date()) {
        const join = new Date(joiningDate);
        const today = new Date(currentDate);
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();
        const currentDateNum = today.getDate();
        const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        
        let months = (currentYear - join.getFullYear()) * 12;
        months += (currentMonth - join.getMonth());
        
        // Only count completed months (not current month if not finished)
        // Check if current month is complete (it's last day after 11:59 PM)
        const isCurrentMonthComplete = this.shouldAccrueCurrentMonth();
        
        if (!isCurrentMonthComplete && currentDateNum <= lastDayOfMonth) {
            // Current month not complete, don't count it
            months = Math.max(0, months);
        } else {
            // Current month is complete, count it
            months = Math.max(0, months + 1);
        }
        
        return months;
    }

    // Calculate total accrued leaves (1.5 days per completed month)
    static calculateTotalAccruedLeaves(joiningDate, currentDate = new Date()) {
        const completedMonths = this.calculateCompletedMonthsFromJoining(joiningDate, currentDate);
        const totalAccrued = completedMonths * 1.5;
        
        return {
            completed_months: completedMonths,
            total_accrued: totalAccrued
        };
    }

    // Get current year's completed months (for display)
    static getCurrentYearCompletedMonths(joiningDate) {
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();
        const currentDate = today.getDate();
        const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        
        const isCurrentMonthComplete = this.shouldAccrueCurrentMonth();
        
        let completedMonthsThisYear = 0;
        
        if (joiningDate.getFullYear() === currentYear) {
            // Joined this year
            const joinMonth = joiningDate.getMonth();
            const joinDay = joiningDate.getDate();
            
            // Calculate months from join month to current month
            let monthsFromJoin = currentMonth - joinMonth;
            
            // If current month is not complete, don't count it
            if (!isCurrentMonthComplete) {
                monthsFromJoin = Math.max(0, monthsFromJoin);
            } else {
                monthsFromJoin = Math.max(0, monthsFromJoin + 1);
            }
            
            // Adjust if joining after 1st of month
            if (joinDay > 1 && isCurrentMonthComplete) {
                // Month of joining still counts (1.5 days for that month)
                completedMonthsThisYear = monthsFromJoin;
            } else {
                completedMonthsThisYear = monthsFromJoin;
            }
        } else {
            // Joined in previous years
            let monthsInYear = currentMonth + 1; // January = 1 month
            
            // If current month is not complete, don't count it
            if (!isCurrentMonthComplete) {
                monthsInYear = Math.max(0, monthsInYear - 1);
            }
            
            completedMonthsThisYear = monthsInYear;
        }
        
        return Math.max(0, completedMonthsThisYear);
    }

    // Add monthly accrual (runs at 11:59 PM on last day of month)
    static async addMonthlyAccrual(employeeId) {
        try {
            const { data: employee, error: empError } = await supabase
                .from('employees')
                .select('joining_date, first_name, last_name')
                .eq('employee_id', employeeId)
                .single();

            if (empError) throw empError;

            const joiningDate = new Date(employee.joining_date);
            const today = new Date();
            const currentYear = today.getFullYear();
            const currentMonth = today.getMonth(); // 0-11
            const currentDate = today.getDate();
            
            // Check if it's time to accrue
            const shouldAccrue = this.shouldAccrueCurrentMonth();
            
            if (!shouldAccrue) {
                const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
                return {
                    success: false,
                    message: `Not time to accrue yet. Current date: ${currentDate}/${currentMonth + 1}/${currentYear}. Accrual happens on last day of month at 11:59 PM.`
                };
            }
            
            // Determine which month to accrue for
            let accrualMonth = currentMonth;
            let accrualYear = currentYear;
            
            // If it's the 1st of next month, accrue for previous month
            if (currentDate === 1) {
                accrualMonth = currentMonth - 1;
                if (accrualMonth < 0) {
                    accrualMonth = 11;
                    accrualYear = currentYear - 1;
                }
            }
            
            const monthName = new Date(accrualYear, accrualMonth, 1).toLocaleString('default', { month: 'long' });
            
            // Check if already accrued for this month
            const { data: existing, error: checkError } = await supabase
                .from('leave_transactions')
                .select('id')
                .eq('employee_id', employeeId)
                .eq('leave_year', accrualYear)
                .eq('transaction_type', 'accrual')
                .eq('transaction_month', accrualMonth + 1)
                .maybeSingle();

            if (existing) {
                return {
                    success: false,
                    message: `Already accrued for ${monthName} ${accrualYear}`
                };
            }
            
            // Add 1.5 leaves
            const accrualAmount = 1.5;
            
            // Get current balance
            const { data: balance, error: balanceError } = await supabase
                .from('leave_balance')
                .select('*')
                .eq('employee_id', employeeId)
                .eq('leave_year', accrualYear)
                .maybeSingle();

            if (!balance) {
                const { error: createError } = await supabase
                    .from('leave_balance')
                    .insert([{
                        employee_id: employeeId,
                        leave_year: accrualYear,
                        total_accrued: accrualAmount,
                        total_used: 0,
                        total_pending: 0,
                        current_balance: accrualAmount,
                        last_updated: today.toISOString()
                    }]);
                if (createError) throw createError;
            } else {
                const newAccrued = (parseFloat(balance.total_accrued) || 0) + accrualAmount;
                const newCurrent = (parseFloat(balance.current_balance) || 0) + accrualAmount;
                
                const { error: updateError } = await supabase
                    .from('leave_balance')
                    .update({
                        total_accrued: newAccrued,
                        current_balance: newCurrent,
                        last_updated: today.toISOString()
                    })
                    .eq('employee_id', employeeId)
                    .eq('leave_year', accrualYear);
                if (updateError) throw updateError;
            }
            
            // Record transaction
            const accrualDate = new Date(accrualYear, accrualMonth + 1, 0); // Last day of month
            
            const { error: transError } = await supabase
                .from('leave_transactions')
                .insert([{
                    employee_id: employeeId,
                    leave_year: accrualYear,
                    transaction_month: accrualMonth + 1,
                    transaction_date: accrualDate.toISOString().split('T')[0],
                    transaction_type: 'accrual',
                    amount: accrualAmount,
                    description: `Monthly leave accrual for ${monthName} ${accrualYear}`
                }]);
            
            if (transError) throw transError;
            
            // Calculate months completed
            const completedMonths = this.calculateCompletedMonthsFromJoining(joiningDate, today);
            
            return {
                success: true,
                message: `Added ${accrualAmount} leaves for ${monthName} ${accrualYear}`,
                employee: `${employee.first_name} ${employee.last_name}`,
                completed_months: completedMonths,
                is_probation_complete: completedMonths >= 6
            };
            
        } catch (error) {
            console.error('Error adding monthly accrual:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }
}

module.exports = LeaveYearlyService;