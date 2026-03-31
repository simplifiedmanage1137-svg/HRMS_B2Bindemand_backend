const cron = require('node-cron');
const LeaveAccrualService = require('../services/leaveAccrualService');

// Run at 00:00 on the first day of every month
// Schedule: '0 0 1 * *' - At 00:00 on day-of-month 1
cron.schedule('0 0 1 * *', async () => {
    console.log('='.repeat(70));
    console.log('🔄 RUNNING MONTHLY LEAVE ACCRUAL JOB');
    console.log('Time:', new Date().toLocaleString());
    console.log('='.repeat(70));
    
    try {
        const result = await LeaveAccrualService.addMonthlyAccrual();
        
        console.log('✅ Monthly leave accrual completed');
        console.log('Results:', JSON.stringify(result, null, 2));
        
        // Log success to database if needed
        try {
            const supabase = require('../config/supabase');
            await supabase
                .from('cron_logs')
                .insert([{
                    job_name: 'monthly_leave_accrual',
                    status: 'success',
                    result: result,
                    executed_at: new Date().toISOString()
                }]);
        } catch (logError) {
            // Silent fail if table doesn't exist
            console.log('Cron logging skipped (table may not exist)');
        }
        
    } catch (error) {
        console.error('❌ Monthly leave accrual failed:', error);
        console.error('Error stack:', error.stack);
        
        // Log failure to database if needed
        try {
            const supabase = require('../config/supabase');
            await supabase
                .from('cron_logs')
                .insert([{
                    job_name: 'monthly_leave_accrual',
                    status: 'failed',
                    error: error.message,
                    executed_at: new Date().toISOString()
                }]);
        } catch (logError) {
            // Silent fail if table doesn't exist
        }
    }
    
    console.log('='.repeat(70) + '\n');
});

// Also can be triggered manually via API
const manualAccrual = async () => {
    console.log('='.repeat(70));
    console.log('🔄 MANUAL LEAVE ACCRUAL TRIGGERED');
    console.log('Time:', new Date().toLocaleString());
    console.log('='.repeat(70));
    
    try {
        const result = await LeaveAccrualService.addMonthlyAccrual();
        
        console.log('✅ Manual accrual completed');
        console.log('Results:', JSON.stringify(result, null, 2));
        
        return {
            success: true,
            message: 'Manual accrual completed successfully',
            result,
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('❌ Manual accrual failed:', error);
        console.error('Error stack:', error.stack);
        
        return {
            success: false,
            message: 'Manual accrual failed',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
};

// Run at 00:00 on the first day of each quarter for quarterly reports (optional)
// Schedule: '0 0 1 */3 *' - At 00:00 on day-of-month 1 in every 3rd month
cron.schedule('0 0 1 */3 *', async () => {
    console.log('='.repeat(70));
    console.log('📊 RUNNING QUARTERLY LEAVE REPORT GENERATION');
    console.log('Time:', new Date().toLocaleString());
    console.log('='.repeat(70));
    
    try {
        // This is optional - you can implement quarterly report generation here
        console.log('Quarterly report generation placeholder');
        
    } catch (error) {
        console.error('❌ Quarterly report generation failed:', error);
    }
});

// Run at 00:00 on January 1st every year for year-end processing
// Schedule: '0 0 1 1 *' - At 00:00 on day-of-month 1 in January
cron.schedule('0 0 1 1 *', async () => {
    console.log('='.repeat(70));
    console.log('🎉 RUNNING YEAR-END LEAVE PROCESSING');
    console.log('Time:', new Date().toLocaleString());
    console.log('='.repeat(70));
    
    try {
        const LeaveYearlyService = require('../services/leaveYearlyService');
        const result = await LeaveYearlyService.resetAllForNewYear();
        
        console.log('✅ Year-end processing completed');
        console.log('Results:', JSON.stringify(result, null, 2));
        
    } catch (error) {
        console.error('❌ Year-end processing failed:', error);
    }
});

// Health check endpoint for cron jobs (can be called by monitoring tools)
const healthCheck = () => {
    return {
        status: 'healthy',
        last_run: global.lastCronRun || null,
        next_run: getNextCronRun(),
        jobs: [
            {
                name: 'monthly_leave_accrual',
                schedule: '0 0 1 * *',
                description: 'Runs on the 1st of every month at midnight'
            },
            {
                name: 'quarterly_report',
                schedule: '0 0 1 */3 *',
                description: 'Runs on the 1st of every quarter at midnight'
            },
            {
                name: 'year_end_processing',
                schedule: '0 0 1 1 *',
                description: 'Runs on January 1st at midnight'
            }
        ]
    };
};

// Helper function to get next cron run time
const getNextCronRun = () => {
    // This is a simplified version - in production, use a proper cron parser
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return nextMonth.toISOString();
};

// Track last run time
cron.schedule('* * * * *', () => {
    // This runs every minute just to update the last run time
    // In production, you'd want to track actual job runs
    global.lastCronRun = new Date().toISOString();
});

module.exports = { 
    manualAccrual,
    healthCheck 
};