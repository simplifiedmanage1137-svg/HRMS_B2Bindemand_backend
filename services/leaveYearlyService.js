// services/leaveYearlyService.js - FINAL FIXED VERSION

const supabase = require('../config/supabase');

class LeaveYearlyService {

    // Check if today is the last day of the month
    static shouldAccrueToday() {
        const now = new Date();
        const today = now.getDate();
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        
        return today === lastDay;
    }

    // Calculate total completed months including current month (if applicable)
    static calculateTotalMonthsFromJoining(joiningDate, currentDate = new Date()) {
        const join = new Date(joiningDate);
        const today = new Date(currentDate);

        if (today < join) {
            return 0;
        }

        // Calculate total months difference including partial months
        let totalMonths = (today.getFullYear() - join.getFullYear()) * 12 + 
                          (today.getMonth() - join.getMonth());
        
        // Add 1 for current month if we've passed the joining day
        if (today.getDate() >= join.getDate()) {
            totalMonths += 1;
        }
        
        return Math.max(0, totalMonths);
    }

    // Get months that should be accrued for an employee
    // Now includes the joining month as earned
    static getMonthsToAccrue(joiningDate, currentDate = new Date()) {
        const join = new Date(joiningDate);
        const today = new Date(currentDate);
        
        // Get the month we're processing (the month that just ended)
        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();
        
        console.log(`📅 getMonthsToAccrue:`, {
            joining_date: joiningDate,
            current_date: today.toISOString().split('T')[0],
            current_month: currentMonth + 1,
            current_year: currentYear,
            is_last_day: this.shouldAccrueToday()
        });
        
        const monthsToAccrue = [];
        
        // Start from joining month (i = 0 includes joining month)
        let startMonth = join.getMonth();
        let startYear = join.getFullYear();
        
        // Loop through all months from joining month to current month
        for (let year = startYear; year <= currentYear; year++) {
            let monthStart = (year === startYear) ? startMonth : 0;
            let monthEnd = (year === currentYear) ? currentMonth + 1 : 12;
            
            for (let month = monthStart; month < monthEnd; month++) {
                // Check if this month is completed
                const monthDate = new Date(year, month, 1);
                const monthEndDate = new Date(year, month + 1, 0);
                
                // For joining month, we consider it completed if we're past the joining date
                let isCompleted = false;
                
                if (year === startYear && month === startMonth) {
                    // Joining month is completed if current date >= joining date
                    isCompleted = today.getDate() >= join.getDate();
                } else {
                    // Other months are completed if we're past the month end
                    isCompleted = today >= monthEndDate;
                }
                
                if (isCompleted) {
                    monthsToAccrue.push({
                        year: year,
                        month: month + 1,
                        monthName: monthDate.toLocaleString('default', { month: 'long' }),
                        accrualDate: new Date(year, month + 1, 1) // 1st of next month
                    });
                }
            }
        }
        
        console.log(`📊 Months to accrue for joining ${joiningDate}:`, 
            monthsToAccrue.map(m => `${m.monthName} ${m.year}`));
        
        return monthsToAccrue;
    }

    // Add monthly accrual for an employee
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

            // Check if it's time to accrue (should run on last day of month)
            if (!this.shouldAccrueToday() && process.env.NODE_ENV !== 'test') {
                return {
                    success: false,
                    message: `Accrual only runs on the last day of each month. Today: ${today.toDateString()}`
                };
            }

            // Get months that should be accrued
            const monthsToAccrue = this.getMonthsToAccrue(joiningDate, today);

            if (monthsToAccrue.length === 0) {
                const currentMonth = today.getMonth() + 1;
                const currentYear = today.getFullYear();
                const joinMonth = joiningDate.getMonth() + 1;
                const joinYear = joiningDate.getFullYear();
                
                let message = `No months to accrue for employee who joined on ${employee.joining_date}`;
                
                // Special message for newly joined employees
                if (joinYear === currentYear && joinMonth === currentMonth) {
                    message = `Employee joined this month (${joinMonth}/${joinYear}). Will accrue 1.5 leaves on last day of this month for joining month.`;
                }
                
                return {
                    success: false,
                    message: message,
                    joining_date: employee.joining_date,
                    today: today.toISOString().split('T')[0]
                };
            }

            // Get already accrued months from transactions
            const { data: existingTransactions, error: transCheckError } = await supabase
                .from('leave_transactions')
                .select('transaction_month, leave_year')
                .eq('employee_id', employeeId)
                .eq('transaction_type', 'accrual');

            if (transCheckError) throw transCheckError;

            // Filter out months already accrued
            const pendingMonths = monthsToAccrue.filter(month => {
                const alreadyAccrued = existingTransactions?.some(t =>
                    t.transaction_month === month.month &&
                    t.leave_year === month.year
                );
                return !alreadyAccrued;
            });

            if (pendingMonths.length === 0) {
                return {
                    success: false,
                    message: `All months already accrued for employee ${employeeId}`,
                    already_accrued: monthsToAccrue.length
                };
            }

            // Calculate total accrual amount
            const accrualAmount = pendingMonths.length * 1.5;
            const currentYear = today.getFullYear();

            console.log(`📊 Monthly Accrual for ${employeeId}:`, {
                employee: `${employee.first_name} ${employee.last_name}`,
                joining_date: employee.joining_date,
                pending_months: pendingMonths.map(m => `${m.monthName} ${m.year}`),
                total_accrual: accrualAmount
            });

            // Get or create leave balance for current year
            const { data: balance, error: balanceError } = await supabase
                .from('leave_balance')
                .select('*')
                .eq('employee_id', employeeId)
                .eq('leave_year', currentYear)
                .maybeSingle();

            if (!balance) {
                // Create new balance
                const { error: createError } = await supabase
                    .from('leave_balance')
                    .insert([{
                        employee_id: employeeId,
                        leave_year: currentYear,
                        total_accrued: accrualAmount,
                        total_used: 0,
                        total_pending: 0,
                        current_balance: accrualAmount,
                        last_updated: today.toISOString()
                    }]);
                if (createError) throw createError;
            } else {
                // Update existing balance
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
                    .eq('leave_year', currentYear);
                if (updateError) throw updateError;
            }

            // Record transactions for each pending month
            const transactions = [];
            for (const month of pendingMonths) {
                // Set transaction date to the last day of the month
                const transactionDate = new Date(month.year, month.month, 0);
                transactions.push({
                    employee_id: employeeId,
                    leave_year: month.year,
                    transaction_month: month.month,
                    transaction_date: transactionDate.toISOString().split('T')[0],
                    transaction_type: 'accrual',
                    amount: 1.5,
                    description: `Monthly leave accrual for ${month.monthName} ${month.year}`
                });
            }

            const { error: transError } = await supabase
                .from('leave_transactions')
                .insert(transactions);

            if (transError) throw transError;

            // Calculate months completed for probation check
            const totalMonths = this.calculateTotalMonthsFromJoining(joiningDate, today);
            const isProbationComplete = totalMonths >= 6;

            return {
                success: true,
                message: `Added ${accrualAmount} leaves (${pendingMonths.length} months × 1.5) for employee ${employeeId}`,
                employee: `${employee.first_name} ${employee.last_name}`,
                pending_months: pendingMonths.map(m => `${m.monthName} ${m.year}`),
                total_accrued: accrualAmount,
                total_months: totalMonths,
                is_probation_complete: isProbationComplete,
                joining_date: employee.joining_date,
                accrual_date: today.toISOString().split('T')[0]
            };

        } catch (error) {
            console.error('Error adding monthly accrual:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    // Calculate total accrued leaves (for display)
    static calculateTotalAccruedLeaves(joiningDate, currentDate = new Date()) {
        const monthsToAccrue = this.getMonthsToAccrue(joiningDate, currentDate);
        const totalAccrued = monthsToAccrue.length * 1.5;
        const totalMonths = this.calculateTotalMonthsFromJoining(joiningDate, currentDate);

        return {
            total_months: totalMonths,
            total_accrued: totalAccrued,
            months_accrued: monthsToAccrue.length,
            months_accrued_list: monthsToAccrue.map(m => `${m.monthName} ${m.year}`)
        };
    }

    // Get current year's accrued months (for display)
    static getCurrentYearAccruedMonths(joiningDate, currentDate = new Date()) {
        const today = new Date(currentDate);
        const currentYear = today.getFullYear();
        const join = new Date(joiningDate);
        
        let accruedMonths = 0;
        
        // Count all months from joining month to current month in current year
        for (let month = 0; month <= today.getMonth(); month++) {
            // Check if this month should be accrued
            if (join.getFullYear() === currentYear && month < join.getMonth()) {
                continue; // Skip months before joining in joining year
            }
            
            // Check if this month is completed
            const monthEnd = new Date(currentYear, month + 1, 0);
            const isCompleted = today >= monthEnd;
            
            if (isCompleted) {
                accruedMonths++;
            } else if (month === today.getMonth() && today.getDate() >= join.getDate()) {
                // For current month, count if we've passed joining date
                accruedMonths++;
            }
        }
        
        return accruedMonths;
    }
    
    // Get next accrual date for an employee
    static getNextAccrualDate(joiningDate, currentDate = new Date()) {
        const today = new Date(currentDate);
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();
        
        // Next accrual will be on the last day of current month
        const nextAccrualDate = new Date(currentYear, currentMonth + 1, 0);
        
        return {
            date: nextAccrualDate.toISOString().split('T')[0],
            is_eligible: true,
            message: `Next accrual will be on ${nextAccrualDate.toISOString().split('T')[0]} (last day of ${nextAccrualDate.toLocaleString('default', { month: 'long' })})`
        };
    }

    // Fix missing accruals for all employees
    static async fixMissingAccruals() {
        try {
            console.log('='.repeat(70));
            console.log('🔧 FIXING MISSING ACCRUALS FOR ALL EMPLOYEES');
            console.log('='.repeat(70));
            
            const { data: employees, error: empError } = await supabase
                .from('employees')
                .select('employee_id, joining_date, first_name, last_name')
                .eq('employee_status', 'Active');
                
            if (empError) throw empError;
            
            const results = {
                total: employees?.length || 0,
                fixed: 0,
                failed: 0,
                details: []
            };
            
            for (const emp of employees || []) {
                console.log(`\n📋 Processing: ${emp.employee_id} (${emp.first_name} ${emp.last_name})`);
                console.log(`   Joining Date: ${emp.joining_date}`);
                
                const result = await this.addMonthlyAccrual(emp.employee_id);
                
                if (result.success) {
                    results.fixed++;
                    results.details.push({
                        employee_id: emp.employee_id,
                        name: `${emp.first_name} ${emp.last_name}`,
                        status: 'fixed',
                        message: result.message,
                        pending_months: result.pending_months
                    });
                    console.log(`   ✅ ${result.message}`);
                } else {
                    results.failed++;
                    results.details.push({
                        employee_id: emp.employee_id,
                        name: `${emp.first_name} ${emp.last_name}`,
                        status: 'skipped',
                        message: result.message
                    });
                    console.log(`   ⚠️ ${result.message}`);
                }
            }
            
            console.log('\n' + '='.repeat(70));
            console.log('📊 FIX SUMMARY:');
            console.log(`   Total employees: ${results.total}`);
            console.log(`   Fixed: ${results.fixed}`);
            console.log(`   Skipped: ${results.failed}`);
            console.log('='.repeat(70));
            
            return results;
            
        } catch (error) {
            console.error('❌ Error fixing missing accruals:', error);
            throw error;
        }
    }
}

module.exports = LeaveYearlyService;