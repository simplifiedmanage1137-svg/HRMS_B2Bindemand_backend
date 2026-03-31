const cron = require('node-cron');
const EmployeeService = require('../services/employeeService');
const supabase = require('../config/supabase');

// Run every day at midnight to update employee months
cron.schedule('0 0 * * *', async () => {
    console.log('='.repeat(70));
    console.log('🔄 RUNNING DAILY EMPLOYEE MONTHS UPDATE');
    console.log('Time:', new Date().toLocaleString());
    console.log('='.repeat(70));
    
    try {
        console.log('📊 Starting monthly count update for all employees...');
        
        const results = await EmployeeService.updateAllEmployeesMonths();
        
        console.log('✅ Employee months updated successfully');
        console.log('📊 Results:', JSON.stringify(results, null, 2));
        
        // Log to cron_logs table if exists
        try {
            await supabase
                .from('cron_logs')
                .insert([{
                    job_name: 'daily_employee_months_update',
                    status: results.failed === 0 ? 'success' : 'partial_success',
                    result: results,
                    executed_at: new Date().toISOString()
                }]);
        } catch (logError) {
            console.log('📝 Cron logging skipped (cron_logs table may not exist)');
        }
        
        // Create notifications for employees whose months changed (e.g., completed 6 months)
        if (results.details) {
            for (const emp of results.details) {
                if (emp.previous_months < 6 && emp.new_months >= 6) {
                    // Employee just completed 6 months - eligible for leave
                    try {
                        await supabase
                            .from('notifications')
                            .insert([{
                                employee_id: emp.employee_id,
                                title: 'Leave Eligibility',
                                message: `Congratulations! You have completed 6 months with us. You are now eligible to apply for leaves.`,
                                type: 'employee_update',
                                created_at: new Date().toISOString()
                            }]);
                        console.log(`📬 Leave eligibility notification sent to ${emp.employee_id}`);
                    } catch (notifError) {
                        console.error(`❌ Failed to send notification to ${emp.employee_id}:`, notifError.message);
                    }
                }
                
                if (emp.previous_months !== emp.new_months) {
                    console.log(`📅 Employee ${emp.employee_id}: ${emp.previous_months} → ${emp.new_months} months`);
                }
            }
        }
        
        console.log('='.repeat(70) + '\n');
        
    } catch (error) {
        console.error('❌ Error updating employee months:', error);
        console.error('Error stack:', error.stack);
        
        // Log failure
        try {
            await supabase
                .from('cron_logs')
                .insert([{
                    job_name: 'daily_employee_months_update',
                    status: 'failed',
                    error: error.message,
                    executed_at: new Date().toISOString()
                }]);
        } catch (logError) {
            // Silent fail
        }
    }
});

// Manual trigger endpoint for testing or manual runs
const manualUpdate = async () => {
    console.log('='.repeat(70));
    console.log('🔄 MANUAL EMPLOYEE MONTHS UPDATE TRIGGERED');
    console.log('Time:', new Date().toLocaleString());
    console.log('='.repeat(70));
    
    try {
        console.log('📊 Starting manual monthly count update...');
        
        const results = await EmployeeService.updateAllEmployeesMonths();
        
        console.log('✅ Manual employee months update completed');
        console.log('📊 Results:', JSON.stringify(results, null, 2));
        
        return {
            success: true,
            message: 'Employee months updated successfully',
            results,
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('❌ Manual update failed:', error);
        return {
            success: false,
            message: 'Failed to update employee months',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
};

// Get last update status
const getLastUpdateStatus = async () => {
    try {
        const { data: logs, error } = await supabase
            .from('cron_logs')
            .select('*')
            .eq('job_name', 'daily_employee_months_update')
            .order('executed_at', { ascending: false })
            .limit(1);

        if (error && error.code !== 'PGRST116') throw error;

        return {
            success: true,
            last_run: logs && logs.length > 0 ? logs[0] : null,
            next_run: getNextRunDate()
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
};

// Helper function to get next run date (midnight tonight)
const getNextRunDate = () => {
    const now = new Date();
    const tonight = new Date(now);
    tonight.setDate(tonight.getDate() + 1);
    tonight.setHours(0, 0, 0, 0);
    return tonight.toISOString();
};

// Update specific employee months
const manualUpdateEmployee = async (employeeId) => {
    console.log('='.repeat(70));
    console.log(`🔄 MANUAL UPDATE FOR EMPLOYEE: ${employeeId}`);
    console.log('Time:', new Date().toLocaleString());
    console.log('='.repeat(70));
    
    try {
        const result = await EmployeeService.updateEmployeeMonths(employeeId);
        
        console.log(`✅ Employee ${employeeId} updated:`, result);
        
        return {
            success: true,
            message: `Employee ${employeeId} updated successfully`,
            result,
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        console.error(`❌ Failed to update employee ${employeeId}:`, error);
        return {
            success: false,
            message: `Failed to update employee ${employeeId}`,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
};

console.log('✅ Daily employee months update cron job scheduled for midnight');

module.exports = { 
    manualUpdate,
    manualUpdateEmployee,
    getLastUpdateStatus 
};