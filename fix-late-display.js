const supabase = require('./config/supabase');

// Format late time for display
const formatLateTime = (lateMinutes) => {
    if (!lateMinutes || lateMinutes <= 0) return null;
    
    const totalSeconds = Math.floor(lateMinutes * 60);
    const hours = Math.floor(totalSeconds / 3600);
    const remainingSeconds = totalSeconds % 3600;
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || (hours === 0 && minutes === 0)) parts.push(`${seconds}s`);

    return parts.join(' ');
};

const fixMissingLateDisplay = async () => {
    try {
        console.log('🚀 Starting fix for missing late_display...\n');
        
        // Get all attendance records with late_minutes > 0 but missing late_display
        const { data: attendanceRecords, error: fetchError } = await supabase
            .from('attendance')
            .select('id, employee_id, attendance_date, late_minutes, late_display, clock_in, clock_in_ist')
            .gt('late_minutes', 0)
            .order('attendance_date', { ascending: false });
            
        if (fetchError) {
            console.error('❌ Error fetching attendance records:', fetchError);
            return;
        }
        
        console.log(`📊 Found ${attendanceRecords.length} records with late_minutes > 0`);
        
        // Filter records that need fixing
        const recordsToFix = attendanceRecords.filter(record => {
            return !record.late_display || record.late_display === '' || record.late_display === null;
        });
        
        console.log(`🔧 Found ${recordsToFix.length} records that need late_display update\n`);
        
        if (recordsToFix.length === 0) {
            console.log('✅ All records already have late_display. No fixes needed.');
            return;
        }
        
        let fixedCount = 0;
        let errorCount = 0;
        
        for (const record of recordsToFix) {
            try {
                const lateMinutes = parseFloat(record.late_minutes);
                const lateDisplay = formatLateTime(lateMinutes);
                
                console.log(`🔧 Fixing record ${record.id}:`);
                console.log(`   Employee: ${record.employee_id}`);
                console.log(`   Date: ${record.attendance_date}`);
                console.log(`   Late Minutes: ${lateMinutes}`);
                console.log(`   Calculated Late Display: ${lateDisplay}`);
                
                // Update the record
                const { error: updateError } = await supabase
                    .from('attendance')
                    .update({ 
                        late_display: lateDisplay,
                        is_late: true // Also ensure is_late flag is set
                    })
                    .eq('id', record.id);
                
                if (updateError) {
                    console.error(`❌ Error updating record ${record.id}:`, updateError);
                    errorCount++;
                } else {
                    console.log(`✅ Updated record ${record.id}`);
                    fixedCount++;
                }
                
            } catch (error) {
                console.error(`❌ Error processing record ${record.id}:`, error);
                errorCount++;
            }
        }
        
        console.log(`\n📊 SUMMARY:`);
        console.log(`   Records processed: ${recordsToFix.length}`);
        console.log(`   Successfully fixed: ${fixedCount}`);
        console.log(`   Errors: ${errorCount}`);
        
        if (fixedCount > 0) {
            console.log(`\n✅ Successfully updated ${fixedCount} attendance records with missing late_display`);
        }
        
    } catch (error) {
        console.error('❌ Fix script error:', error);
    }
};

// Also fix today's records specifically
const fixTodayRecords = async () => {
    try {
        console.log('\n🔧 Checking today\'s records specifically...\n');
        
        const today = new Date().toISOString().split('T')[0];
        
        const { data: todayRecords, error: fetchError } = await supabase
            .from('attendance')
            .select('id, employee_id, late_minutes, late_display, clock_in, clock_in_ist')
            .eq('attendance_date', today)
            .gt('late_minutes', 0);
            
        if (fetchError) {
            console.error('❌ Error fetching today\'s records:', fetchError);
            return;
        }
        
        console.log(`📊 Found ${todayRecords.length} late records for today (${today})`);
        
        for (const record of todayRecords) {
            const lateMinutes = parseFloat(record.late_minutes);
            const currentLateDisplay = record.late_display;
            const calculatedLateDisplay = formatLateTime(lateMinutes);
            
            console.log(`\n👤 Employee ${record.employee_id}:`);
            console.log(`   Late Minutes: ${lateMinutes}`);
            console.log(`   Current Late Display: "${currentLateDisplay}"`);
            console.log(`   Calculated Late Display: "${calculatedLateDisplay}"`);
            
            if (!currentLateDisplay || currentLateDisplay !== calculatedLateDisplay) {
                console.log(`🔧 Updating late_display...`);
                
                const { error: updateError } = await supabase
                    .from('attendance')
                    .update({ 
                        late_display: calculatedLateDisplay,
                        is_late: true
                    })
                    .eq('id', record.id);
                
                if (updateError) {
                    console.error(`❌ Error updating:`, updateError);
                } else {
                    console.log(`✅ Updated successfully`);
                }
            } else {
                console.log(`✅ Already correct`);
            }
        }
        
    } catch (error) {
        console.error('❌ Error fixing today\'s records:', error);
    }
};

// Run both fix functions
const runFixes = async () => {
    await fixMissingLateDisplay();
    await fixTodayRecords();
};

runFixes().then(() => {
    console.log('\n✅ Fix script completed');
    process.exit(0);
}).catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
});