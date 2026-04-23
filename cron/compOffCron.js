const cron = require('node-cron');
const CompOffService = require('../services/compOffService');

// Run at midnight every day
cron.schedule('0 0 * * *', async () => {
    console.log('🔄 Running comp-off expiry check...');
    try {
        const result = await CompOffService.expireCompOffs();
        console.log(`✅ Expired ${result.expired} comp-off leaves`);
    } catch (error) {
        console.error('❌ Error expiring comp-offs:', error);
    }
});