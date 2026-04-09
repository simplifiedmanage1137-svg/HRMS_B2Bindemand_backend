// cron/leaveAccrual.js
const LeaveYearlyService = require('../services/leaveYearlyService');

async function runMonthlyAccrual() {
    console.log('\n🚀 Starting monthly leave accrual check...');
    
    try {
        const result = await LeaveYearlyService.addMonthlyAccrual();
        
        if (result.success) {
            console.log('✅ Monthly accrual completed successfully');
            console.log(`Summary: ${JSON.stringify(result.summary, null, 2)}`);
        } else {
            console.log('⚠️', result.message);
        }
    } catch (error) {
        console.error('❌ Monthly accrual failed:', error);
    }
}

async function runYearEndReset() {
    console.log('\n🎆 Starting year-end leave reset...');
    
    try {
        const result = await LeaveYearlyService.resetForNewYear();
        
        if (result.success) {
            console.log('✅ Year-end reset completed successfully');
            console.log(`Summary: ${JSON.stringify(result.results, null, 2)}`);
        }
    } catch (error) {
        console.error('❌ Year-end reset failed:', error);
    }
}

// Run based on command line argument
const args = process.argv.slice(2);
const command = args[0];

if (command === 'monthly') {
    runMonthlyAccrual();
} else if (command === 'yearly') {
    runYearEndReset();
} else {
    console.log('Usage: node cron/leaveAccrual.js [monthly|yearly]');
}

module.exports = { runMonthlyAccrual, runYearEndReset };