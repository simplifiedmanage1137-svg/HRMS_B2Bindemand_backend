/**
 * Backfill Comp-Off for employees who worked on holidays but didn't get comp-off
 * Uses attendance.is_holiday flag + holiday_name (matches frontend calendar)
 * Run: node backend/scripts/backfill-compoff.js
 */

const supabase = require('../config/supabase');
const CompOffService = require('../services/compOffService');

async function backfillCompOff() {
    console.log('🔄 Starting Comp-Off backfill (using frontend calendar holidays)...');

    // Get all attendance records where is_holiday=true, 9+ hours, clocked out
    const { data: records, error } = await supabase
        .from('attendance')
        .select('employee_id, attendance_date, total_hours, holiday_name')
        .eq('is_holiday', true)
        .gte('total_hours', 9)
        .not('clock_out', 'is', null);

    if (error) {
        console.error('❌ Error fetching attendance:', error);
        return;
    }

    console.log(`📊 Found ${records?.length || 0} holiday attendance records with 9+ hours`);

    let awarded = 0, skipped = 0;

    for (const record of (records || [])) {
        try {
            const result = await CompOffService.checkHolidayWork(
                record.employee_id,
                record.attendance_date,
                parseFloat(record.total_hours),
                record.holiday_name  // use holiday_name from attendance record
            );
            if (result) {
                console.log(`✅ Comp-Off awarded: ${record.employee_id} for ${record.attendance_date} (${record.holiday_name})`);
                awarded++;
            } else {
                skipped++;
            }
        } catch (err) {
            console.error(`❌ Error for ${record.employee_id} on ${record.attendance_date}:`, err.message);
            skipped++;
        }
    }

    console.log(`\n📈 Backfill complete: ${awarded} awarded, ${skipped} skipped/already-exists`);
}

backfillCompOff().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
