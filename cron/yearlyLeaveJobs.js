const cron = require('node-cron');
const LeaveYearlyService = require('../services/leaveYearlyService');
const supabase = require('../config/supabase');

// Run monthly accrual on 1st of every month at 00:00
cron.schedule('0 0 1 * *', async () => {
    console.log('='.repeat(70));
    console.log('🔄 RUNNING MONTHLY LEAVE ACCRUAL JOB FOR ALL EMPLOYEES');
    console.log('Time:', new Date().toLocaleString());
    console.log('='.repeat(70));
    
    try {
        // Get all employees
        const { data: employees, error } = await supabase
            .from('employees')
            .select('employee_id, first_name, last_name, joining_date');

        if (error) throw error;

        console.log(`📊 Found ${employees?.length || 0} employees to process`);

        const results = {
            total: employees?.length || 0,
            successful: 0,
            failed: 0,
            skipped: 0,
            details: []
        };

        const currentYear = new Date().getFullYear();
        const previousMonth = new Date().getMonth(); // 0-11 (previous month)
        const monthName = new Date(currentYear, previousMonth, 1).toLocaleString('default', { month: 'long' });

        for (const emp of employees || []) {
            try {
                console.log(`Processing employee: ${emp.employee_id} (${emp.first_name} ${emp.last_name})`);
                
                // Check if employee has completed 6 months
                const joiningDate = new Date(emp.joining_date);
                const today = new Date();
                const sixMonthsFromJoining = new Date(joiningDate);
                sixMonthsFromJoining.setMonth(sixMonthsFromJoining.getMonth() + 6);
                
                if (today < sixMonthsFromJoining) {
                    results.skipped++;
                    results.details.push({
                        employee_id: emp.employee_id,
                        name: `${emp.first_name} ${emp.last_name}`,
                        status: 'skipped',
                        message: 'Employee has not completed 6 months yet'
                    });
                    console.log(`⏭️ Skipped ${emp.employee_id} - not completed 6 months`);
                    continue;
                }
                
                // Check if already accrued for previous month
                const { data: existing, error: checkError } = await supabase
                    .from('leave_transactions')
                    .select('id')
                    .eq('employee_id', emp.employee_id)
                    .eq('leave_year', currentYear)
                    .eq('transaction_type', 'accrual')
                    .gte('transaction_date', `${currentYear}-${String(previousMonth + 1).padStart(2, '0')}-01`)
                    .lt('transaction_date', `${currentYear}-${String(previousMonth + 2).padStart(2, '0')}-01`);

                if (checkError) throw checkError;

                if (!existing || existing.length === 0) {
                    // Add monthly accrual
                    const result = await LeaveYearlyService.addMonthlyAccrual(emp.employee_id);
                    
                    results.successful++;
                    results.details.push({
                        employee_id: emp.employee_id,
                        name: `${emp.first_name} ${emp.last_name}`,
                        status: 'success',
                        message: result.message || `Added 1.5 leaves for ${monthName}`
                    });
                    
                    console.log(`✅ Success for ${emp.employee_id}:`, result.message);
                } else {
                    results.skipped++;
                    results.details.push({
                        employee_id: emp.employee_id,
                        name: `${emp.first_name} ${emp.last_name}`,
                        status: 'skipped',
                        message: `Already accrued for ${monthName}`
                    });
                    console.log(`⏭️ Already accrued for ${emp.employee_id}`);
                }
                
            } catch (empError) {
                results.failed++;
                results.details.push({
                    employee_id: emp.employee_id,
                    name: `${emp.first_name} ${emp.last_name}`,
                    status: 'failed',
                    error: empError.message
                });
                console.error(`❌ Error adding accrual for ${emp.employee_id}:`, empError.message);
            }
        }

        console.log('='.repeat(70));
        console.log('📊 MONTHLY ACCRUAL SUMMARY');
        console.log(`Month: ${monthName} ${currentYear}`);
        console.log(`Total employees: ${results.total}`);
        console.log(`Successful: ${results.successful}`);
        console.log(`Skipped: ${results.skipped}`);
        console.log(`Failed: ${results.failed}`);
        console.log('='.repeat(70));

        // Log to cron_logs table if exists
        try {
            await supabase
                .from('cron_logs')
                .insert([{
                    job_name: 'monthly_leave_accrual',
                    status: results.failed === 0 ? 'success' : results.failed === results.total ? 'failed' : 'partial_success',
                    result: {
                        month: monthName,
                        year: currentYear,
                        successful: results.successful,
                        skipped: results.skipped,
                        failed: results.failed,
                        details: results.details
                    },
                    executed_at: new Date().toISOString()
                }]);
        } catch (logError) {
            console.log('📝 Cron logging skipped (cron_logs table may not exist)');
        }

        console.log('✅ Monthly leave accrual completed for all employees');
        
    } catch (error) {
        console.error('❌ Monthly accrual job failed:', error);
        console.error('Error stack:', error.stack);
        
        // Log failure
        try {
            await supabase
                .from('cron_logs')
                .insert([{
                    job_name: 'monthly_leave_accrual',
                    status: 'failed',
                    error: error.message,
                    executed_at: new Date().toISOString()
                }]);
        } catch (logError) {
            // Silent fail
        }
    }
    
    console.log('='.repeat(70) + '\n');
});

// Run yearly reset on January 1st at 00:00
cron.schedule('0 0 1 1 *', async () => {
    console.log('='.repeat(70));
    console.log('🎉 RUNNING YEARLY LEAVE RESET JOB');
    console.log('Time:', new Date().toLocaleString());
    console.log('='.repeat(70));
    
    try {
        const result = await LeaveYearlyService.resetAllForNewYear();
        
        console.log('✅ Yearly reset completed');
        console.log('📊 Results:', JSON.stringify(result, null, 2));
        
        // Log to cron_logs
        try {
            await supabase
                .from('cron_logs')
                .insert([{
                    job_name: 'yearly_leave_reset',
                    status: result.success ? 'success' : 'failed',
                    result: result,
                    executed_at: new Date().toISOString()
                }]);
        } catch (logError) {
            console.log('📝 Cron logging skipped');
        }
        
    } catch (error) {
        console.error('❌ Yearly reset failed:', error);
        console.error('Error stack:', error.stack);
        
        // Log failure
        try {
            await supabase
                .from('cron_logs')
                .insert([{
                    job_name: 'yearly_leave_reset',
                    status: 'failed',
                    error: error.message,
                    executed_at: new Date().toISOString()
                }]);
        } catch (logError) {
            // Silent fail
        }
    }
    
    console.log('='.repeat(70) + '\n');
});

// Manual trigger for monthly accrual (single employee or all)
const manualMonthlyAccrual = async (employee_id = null) => {
    console.log('='.repeat(70));
    console.log('🔄 MANUAL MONTHLY ACCRUAL TRIGGERED');
    console.log('Time:', new Date().toLocaleString());
    console.log('Employee ID:', employee_id || 'ALL EMPLOYEES');
    console.log('='.repeat(70));
    
    try {
        let results = [];
        
        if (employee_id) {
            // Single employee
            const result = await LeaveYearlyService.addMonthlyAccrual(employee_id);
            results.push({
                employee_id,
                success: result.success,
                message: result.message
            });
        } else {
            // All employees
            const { data: employees, error } = await supabase
                .from('employees')
                .select('employee_id, first_name, last_name, joining_date');

            if (error) throw error;

            const currentYear = new Date().getFullYear();
            const previousMonth = new Date().getMonth();
            const monthName = new Date(currentYear, previousMonth, 1).toLocaleString('default', { month: 'long' });

            for (const emp of employees || []) {
                try {
                    // Check 6 months eligibility
                    const joiningDate = new Date(emp.joining_date);
                    const today = new Date();
                    const sixMonthsFromJoining = new Date(joiningDate);
                    sixMonthsFromJoining.setMonth(sixMonthsFromJoining.getMonth() + 6);
                    
                    if (today < sixMonthsFromJoining) {
                        results.push({
                            employee_id: emp.employee_id,
                            name: `${emp.first_name} ${emp.last_name}`,
                            success: false,
                            message: 'Employee has not completed 6 months yet'
                        });
                        continue;
                    }
                    
                    const result = await LeaveYearlyService.addMonthlyAccrual(emp.employee_id);
                    results.push({
                        employee_id: emp.employee_id,
                        name: `${emp.first_name} ${emp.last_name}`,
                        success: result.success,
                        message: result.message
                    });
                } catch (empError) {
                    results.push({
                        employee_id: emp.employee_id,
                        name: `${emp.first_name} ${emp.last_name}`,
                        success: false,
                        error: empError.message
                    });
                }
            }
        }
        
        const summary = {
            total: results.length,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length
        };
        
        console.log('📊 MANUAL ACCRUAL SUMMARY:', summary);
        
        return {
            success: true,
            message: employee_id ? `Manual accrual for employee ${employee_id} completed` : 'Manual accrual for all employees completed',
            summary,
            results,
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('❌ Manual monthly accrual failed:', error);
        return {
            success: false,
            message: 'Manual accrual failed',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
};

// Manual trigger for yearly reset
const manualYearlyReset = async () => {
    console.log('='.repeat(70));
    console.log('🎉 MANUAL YEARLY RESET TRIGGERED');
    console.log('Time:', new Date().toLocaleString());
    console.log('='.repeat(70));
    
    try {
        const result = await LeaveYearlyService.resetAllForNewYear();
        
        console.log('✅ Manual yearly reset completed');
        console.log('📊 Results:', result);
        
        return {
            success: true,
            message: 'Yearly reset completed successfully',
            result,
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('❌ Manual yearly reset failed:', error);
        return {
            success: false,
            message: 'Yearly reset failed',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
};

// Get last run status
const getLastRunStatus = async () => {
    try {
        const { data: logs, error } = await supabase
            .from('cron_logs')
            .select('*')
            .eq('job_name', 'monthly_leave_accrual')
            .order('executed_at', { ascending: false })
            .limit(1);

        if (error && error.code !== 'PGRST116') throw error;

        return {
            success: true,
            last_run: logs && logs.length > 0 ? logs[0] : null,
            next_run: getNextMonthlyRun()
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
};

// Helper function to get next monthly run date
const getNextMonthlyRun = () => {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0);
    return nextMonth.toISOString();
};

console.log('✅ Monthly leave accrual cron job scheduled for 00:00 on the 1st of every month');
console.log('✅ Yearly leave reset cron job scheduled for 00:00 on January 1st');

module.exports = { 
    manualMonthlyAccrual, 
    manualYearlyReset,
    getLastRunStatus 
};