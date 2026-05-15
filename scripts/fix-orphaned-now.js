// Run this ONCE to fix all existing broken records immediately
// Usage: node scripts/fix-orphaned-now.js

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const attendanceController = require('../controllers/attendanceController');

(async () => {
    console.log('🔧 Fixing all orphaned attendance records...');
    const result = await attendanceController.fixOrphanedAttendance(null, null);
    console.log(`✅ Done: ${result.fixed} fixed, ${result.skipped} skipped`);
    if (result.error) console.error('❌ Error:', result.error);
    process.exit(0);
})();
