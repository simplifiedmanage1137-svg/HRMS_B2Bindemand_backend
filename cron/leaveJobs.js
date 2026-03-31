const cron = require('node-cron');
const LeaveYearlyService = require('../services/leaveYearlyService');
const supabase = require('../config/supabase');

// Run monthly accrual on 1st of every month at 00:01
cron.schedule('1 0 1 * *', async () => {
    console.log('='.repeat(70));
    console.log('🔄 RUNNING MONTHLY LEAVE ACCRUAL JOB FOR PREVIOUS MONTH');
    console.log('Time:', new Date().toLocaleString());
    console.log('='.repeat(70));
    
    try {
        // Get all employees
        const { data: employees, error } = await supabase
            .from('employees')
            .select('employee_id, joining_date, first_name, last_name');

        if (error) throw error;

        console.log(`📊 Found ${employees?.length || 0} employees to process`);

        const results = {
            total: employees?.length || 0,
            successful: 0,
            failed: 0,
            errors: []
        };

        for (const emp of employees || []) {
            try {
                console.log(`Processing employee: ${emp.employee_id} (${emp.first_name} ${emp.last_name})`);
                
                const result = await LeaveYearlyService.addMonthlyAccrual(emp.employee_id);
                
                if (result && result.success) {
                    results.successful++;
                    console.log(`✅ Success for ${emp.employee_id}:`, result.message);
                } else {
                    results.failed++;
                    results.errors.push({
                        employee_id: emp.employee_id,
                        error: result?.message || 'Unknown error'
                    });
                    console.error(`❌ Failed for ${emp.employee_id}:`, result?.message);
                }
                
            } catch (empError) {
                results.failed++;
                results.errors.push({
                    employee_id: emp.employee_id,
                    error: empError.message
                });
                console.error(`❌ Error adding accrual for ${emp.employee_id}:`, empError.message);
            }
        }
        
        console.log('='.repeat(70));
        console.log('📊 MONTHLY ACCRUAL SUMMARY');
        console.log('Total employees:', results.total);
        console.log('Successful:', results.successful);
        console.log('Failed:', results.failed);
        if (results.errors.length > 0) {
            console.log('Errors:', results.errors);
        }
        console.log('='.repeat(70));
        
        // Log to cron_logs table if exists
        try {
            await supabase
                .from('cron_logs')
                .insert([{
                    job_name: 'monthly_leave_accrual',
                    status: results.failed === 0 ? 'success' : 'partial_success',
                    result: results,
                    executed_at: new Date().toISOString()
                }]);
        } catch (logError) {
            // Silent fail if table doesn't exist
            console.log('Cron logging skipped (cron_logs table may not exist)');
        }
        
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
        const result = await LeaveYearlyService.resetForNewYear();
        
        console.log('✅ Yearly reset completed');
        console.log('Results:', JSON.stringify(result, null, 2));
        
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
            // Silent fail
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

// Run weekly check for pending leave balances (every Monday at 9 AM)
cron.schedule('0 9 * * 1', async () => {
    console.log('='.repeat(70));
    console.log('📊 RUNNING WEEKLY LEAVE BALANCE CHECK');
    console.log('Time:', new Date().toLocaleString());
    console.log('='.repeat(70));
    
    try {
        const { data: employees, error } = await supabase
            .from('employees')
            .select('employee_id, first_name, last_name');

        if (error) throw error;

        let lowBalanceCount = 0;
        
        for (const emp of employees || []) {
            try {
                const { data: balance, error: balanceError } = await supabase
                    .from('leave_balance')
                    .select('current_balance, leave_year')
                    .eq('employee_id', emp.employee_id)
                    .eq('leave_year', new Date().getFullYear())
                    .single();

                if (balanceError && balanceError.code !== 'PGRST116') throw balanceError;

                if (balance && balance.current_balance < 2) {
                    lowBalanceCount++;
                    console.log(`⚠️ Low leave balance for ${emp.employee_id}: ${balance.current_balance} days`);
                    
                    // Create notification for low balance
                    await supabase
                        .from('notifications')
                        .insert([{
                            employee_id: emp.employee_id,
                            message: `Your leave balance is low (${balance.current_balance} days remaining). Please plan your leaves accordingly.`,
                            type: 'leave_alert',
                            created_at: new Date().toISOString()
                        }]);
                }
            } catch (empError) {
                console.error(`Error checking balance for ${emp.employee_id}:`, empError.message);
            }
        }

        console.log(`✅ Weekly check completed. Found ${lowBalanceCount} employees with low balance.`);
        
    } catch (error) {
        console.error('❌ Weekly balance check failed:', error);
    }
});

// Manual trigger functions
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
                .select('employee_id, first_name, last_name');

            if (error) throw error;

            for (const emp of employees || []) {
                try {
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
        console.log('Details:', results);
        
        return {
            success: true,
            message: 'Manual accrual completed',
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

const manualYearlyReset = async () => {
    console.log('='.repeat(70));
    console.log('🎉 MANUAL YEARLY RESET TRIGGERED');
    console.log('Time:', new Date().toLocaleString());
    console.log('='.repeat(70));
    
    try {
        const result = await LeaveYearlyService.resetForNewYear();
        
        console.log('✅ Manual yearly reset completed');
        console.log('Results:', result);
        
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

// Get cron job status
const getCronStatus = async () => {
    try {
        // Get last 10 cron job runs
        const { data: logs, error } = await supabase
            .from('cron_logs')
            .select('*')
            .order('executed_at', { ascending: false })
            .limit(10);

        if (error && error.code !== 'PGRST116') throw error;

        return {
            success: true,
            jobs: [
                {
                    name: 'monthly_leave_accrual',
                    schedule: '1 0 1 * *',
                    description: 'Runs on 1st of every month at 00:01',
                    next_run: getNextMonthlyRun()
                },
                {
                    name: 'yearly_leave_reset',
                    schedule: '0 0 1 1 *',
                    description: 'Runs on January 1st at 00:00',
                    next_run: getNextYearlyRun()
                },
                {
                    name: 'weekly_balance_check',
                    schedule: '0 9 * * 1',
                    description: 'Runs every Monday at 9 AM',
                    next_run: getNextMondayRun()
                }
            ],
            recent_runs: logs || []
        };
        
    } catch (error) {
        return {
            success: false,
            message: 'Failed to get cron status',
            error: error.message
        };
    }
};

// Helper functions for next run calculations
const getNextMonthlyRun = () => {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 1, 0);
    return nextMonth.toISOString();
};

const getNextYearlyRun = () => {
    const now = new Date();
    const nextYear = new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0);
    return nextYear.toISOString();
};

const getNextMondayRun = () => {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const daysUntilMonday = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7;
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + daysUntilMonday);
    nextMonday.setHours(9, 0, 0, 0);
    return nextMonday.toISOString();
};

module.exports = { 
    manualMonthlyAccrual, 
    manualYearlyReset,
    getCronStatus 
};