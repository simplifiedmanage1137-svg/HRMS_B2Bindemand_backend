// cron/monthlyLeaveAccrual.js
const cron = require('node-cron');
const LeaveYearlyService = require('../services/leaveYearlyService');

// ============== MONTHLY LEAVE ACCRUAL ==============
// ✅ Runs at 00:00 (midnight) on the LAST DAY of every month
cron.schedule('0 0 28-31 * *', async () => {
    const now = new Date();
    const currentDate = now.getDate();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    
    // Check if today is actually the last day of the month
    const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    
    if (currentDate !== lastDayOfMonth) {
        // Not the last day, skip
        return;
    }
    
    console.log('='.repeat(70));
    console.log('🔄 MONTHLY LEAVE ACCRUAL - MIDNIGHT TRIGGER');
    console.log('Date:', now.toLocaleString());
    console.log('Time:', now.toLocaleTimeString());
    console.log(`Month: ${now.toLocaleString('default', { month: 'long' })} ${currentYear}`);
    console.log('='.repeat(70));
    
    try {
        // Call the service method (which processes all eligible employees)
        const result = await LeaveYearlyService.addMonthlyAccrual();
        
        if (result.success) {
            console.log('✅ Monthly accrual completed successfully');
            console.log('Summary:', result.summary);
        } else {
            console.log('⚠️', result.message);
        }
        
        console.log('='.repeat(70) + '\n');
        
    } catch (error) {
        console.error('❌ Monthly accrual job failed:', error);
    }
});

// ============== YEAR-END LEAVE RESET ==============
// ✅ Runs at 00:00 (midnight) on JANUARY 1st every year
cron.schedule('0 0 1 1 *', async () => {
    const now = new Date();
    
    console.log('='.repeat(70));
    console.log('🎆 YEAR-END LEAVE RESET - MIDNIGHT TRIGGER');
    console.log('Date:', now.toLocaleString());
    console.log('New Year:', now.getFullYear());
    console.log('='.repeat(70));
    
    try {
        const result = await LeaveYearlyService.resetForNewYear();
        
        if (result.success) {
            console.log('✅ Year-end reset completed successfully');
            console.log('Results:', result.results);
        } else {
            console.log('⚠️ Reset incomplete');
        }
        
        console.log('='.repeat(70) + '\n');
        
    } catch (error) {
        console.error('❌ Year-end reset failed:', error);
    }
});

console.log('✅ Monthly leave accrual cron: 00:00 on last day of month');
console.log('✅ Year-end reset cron: 00:00 on January 1st');

module.exports = {};