// cron/yearEndReset.js
const cron = require('node-cron');
const LeaveYearlyService = require('../services/leaveYearlyService');
const supabase = require('../config/supabase');

// Run on December 31st at 23:59 (last minute of the year)
cron.schedule('59 23 31 12 *', async () => {
    console.log('='.repeat(70));
    console.log('🎉 RUNNING YEAR-END LEAVE RESET');
    console.log('Date:', new Date().toLocaleString());
    console.log('This will archive current year leaves and reset for new year');
    console.log('='.repeat(70));
    
    try {
        const result = await LeaveYearlyService.yearEndReset();
        
        console.log('✅ Year-end reset completed');
        console.log('Results:', JSON.stringify(result, null, 2));
        
        // Log to database
        try {
            await supabase
                .from('cron_logs')
                .insert([{
                    job_name: 'year_end_reset',
                    status: result.success ? 'success' : 'failed',
                    result: result,
                    executed_at: new Date().toISOString()
                }]);
        } catch (logError) {
            console.log('Cron logging skipped');
        }
        
    } catch (error) {
        console.error('❌ Year-end reset failed:', error);
        
        try {
            await supabase
                .from('cron_logs')
                .insert([{
                    job_name: 'year_end_reset',
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

console.log('✅ Year-end reset cron job scheduled for Dec 31 at 23:59');