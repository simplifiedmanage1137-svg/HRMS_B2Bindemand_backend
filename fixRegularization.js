// fixRegularization.js
const supabase = require('./config/supabase');

const fixRegularizationTimes = async () => {
    try {
        console.log('='.repeat(70));
        console.log('🔧 FIXING REGULARIZATION TIMES');
        console.log('='.repeat(70));
        
        // Step 1: Fix regularization_requests table
        console.log('\n📋 Fixing regularization_requests table...');
        
        const { data: requests, error } = await supabase
            .from('regularization_requests')
            .select('*')
            .eq('status', 'approved');
        
        if (error) throw error;
        
        console.log(`Found ${requests.length} approved requests`);
        
        let fixedRequestsCount = 0;
        
        for (const req of requests) {
            let fixed = false;
            let newApprovedTime = req.approved_clock_out_time;
            let newRequestedTime = req.requested_clock_out_time;
            
            // Fix approved_clock_out_time
            if (req.approved_clock_out_time) {
                let originalTime = req.approved_clock_out_time;
                
                // If it's a Date object
                if (originalTime instanceof Date || (typeof originalTime === 'object' && originalTime !== null)) {
                    const date = new Date(originalTime);
                    if (!isNaN(date.getTime())) {
                        // Convert to IST
                        const istDate = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
                        const year = istDate.getUTCFullYear();
                        const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
                        const day = String(istDate.getUTCDate()).padStart(2, '0');
                        const hour = String(istDate.getUTCHours()).padStart(2, '0');
                        const minute = String(istDate.getUTCMinutes()).padStart(2, '0');
                        const second = String(istDate.getUTCSeconds()).padStart(2, '0');
                        newApprovedTime = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
                        fixed = true;
                        console.log(`   Request ${req.id}: Approved time fixed`);
                        console.log(`      Before: ${originalTime}`);
                        console.log(`      After:  ${newApprovedTime}`);
                    }
                }
                // If it's a string with T
                else if (typeof originalTime === 'string' && originalTime.includes('T')) {
                    newApprovedTime = originalTime.replace('T', ' ').substring(0, 19);
                    fixed = true;
                    console.log(`   Request ${req.id}: Approved time fixed (T format)`);
                    console.log(`      Before: ${originalTime}`);
                    console.log(`      After:  ${newApprovedTime}`);
                }
                // If it's a string with timezone offset
                else if (typeof originalTime === 'string' && (originalTime.includes('+') || originalTime.includes('Z'))) {
                    newApprovedTime = originalTime.substring(0, 19);
                    fixed = true;
                    console.log(`   Request ${req.id}: Approved time fixed (timezone offset)`);
                    console.log(`      Before: ${originalTime}`);
                    console.log(`      After:  ${newApprovedTime}`);
                }
            }
            
            // Fix requested_clock_out_time
            if (req.requested_clock_out_time && typeof req.requested_clock_out_time === 'string' && req.requested_clock_out_time.includes('T')) {
                newRequestedTime = req.requested_clock_out_time.replace('T', ' ').substring(0, 19);
                fixed = true;
                console.log(`   Request ${req.id}: Requested time fixed`);
                console.log(`      Before: ${req.requested_clock_out_time}`);
                console.log(`      After:  ${newRequestedTime}`);
            }
            
            if (fixed) {
                const { error: updateError } = await supabase
                    .from('regularization_requests')
                    .update({ 
                        approved_clock_out_time: newApprovedTime,
                        requested_clock_out_time: newRequestedTime
                    })
                    .eq('id', req.id);
                
                if (updateError) {
                    console.error(`   ❌ Error updating request ${req.id}:`, updateError.message);
                } else {
                    fixedRequestsCount++;
                    console.log(`   ✅ Request ${req.id} updated successfully`);
                }
            }
        }
        
        console.log(`\n✅ Fixed ${fixedRequestsCount} regularization requests`);
        
        // Step 2: Fix attendance records
        console.log('\n📋 Fixing attendance records...');
        
        const { data: attendanceRecords, error: attError } = await supabase
            .from('attendance')
            .select('*')
            .eq('is_regularized', true);
        
        if (attError) throw attError;
        
        console.log(`Found ${attendanceRecords.length} regularized records`);
        
        let fixedAttendanceCount = 0;
        
        for (const record of attendanceRecords) {
            let fixed = false;
            let newClockOut = record.clock_out_ist;
            let newClockIn = record.clock_in_ist;
            
            // Fix clock_out_ist
            if (record.clock_out_ist && typeof record.clock_out_ist === 'string') {
                if (record.clock_out_ist.includes('T')) {
                    newClockOut = record.clock_out_ist.replace('T', ' ').substring(0, 19);
                    fixed = true;
                    console.log(`   Record ${record.id} (${record.attendance_date}): Clock out fixed`);
                    console.log(`      Before: ${record.clock_out_ist}`);
                    console.log(`      After:  ${newClockOut}`);
                } else if (record.clock_out_ist.includes('+') || record.clock_out_ist.includes('Z')) {
                    newClockOut = record.clock_out_ist.substring(0, 19);
                    fixed = true;
                    console.log(`   Record ${record.id}: Clock out fixed (timezone)`);
                    console.log(`      Before: ${record.clock_out_ist}`);
                    console.log(`      After:  ${newClockOut}`);
                }
            }
            
            // Fix clock_in_ist
            if (record.clock_in_ist && typeof record.clock_in_ist === 'string') {
                if (record.clock_in_ist.includes('T')) {
                    newClockIn = record.clock_in_ist.replace('T', ' ').substring(0, 19);
                    fixed = true;
                    console.log(`   Record ${record.id}: Clock in fixed`);
                    console.log(`      Before: ${record.clock_in_ist}`);
                    console.log(`      After:  ${newClockIn}`);
                }
            }
            
            if (fixed) {
                const { error: updateError } = await supabase
                    .from('attendance')
                    .update({ 
                        clock_out_ist: newClockOut,
                        clock_in_ist: newClockIn
                    })
                    .eq('id', record.id);
                
                if (updateError) {
                    console.error(`   ❌ Error updating record ${record.id}:`, updateError.message);
                } else {
                    fixedAttendanceCount++;
                    console.log(`   ✅ Record ${record.id} updated successfully`);
                }
            }
        }
        
        console.log(`\n✅ Fixed ${fixedAttendanceCount} attendance records`);
        
        // Step 3: Verify the fixes
        console.log('\n📊 VERIFICATION - Last 5 approved requests:');
        
        const { data: verifiedRequests, error: verifyError } = await supabase
            .from('regularization_requests')
            .select('id, attendance_date, requested_clock_out_time, approved_clock_out_time, status')
            .eq('status', 'approved')
            .order('approved_at', { ascending: false })
            .limit(5);
        
        if (verifyError) throw verifyError;
        
        verifiedRequests.forEach(req => {
            console.log(`\n   Request ${req.id}:`);
            console.log(`      Date: ${req.attendance_date}`);
            console.log(`      Requested: ${req.requested_clock_out_time}`);
            console.log(`      Approved: ${req.approved_clock_out_time}`);
        });
        
        console.log('\n📊 VERIFICATION - Last 5 regularized attendance records:');
        
        const { data: verifiedAttendance, error: attVerifyError } = await supabase
            .from('attendance')
            .select('id, attendance_date, clock_in_ist, clock_out_ist, is_regularized')
            .eq('is_regularized', true)
            .order('attendance_date', { ascending: false })
            .limit(5);
        
        if (attVerifyError) throw attVerifyError;
        
        verifiedAttendance.forEach(record => {
            console.log(`\n   Record ${record.id} (${record.attendance_date}):`);
            console.log(`      Clock In: ${record.clock_in_ist}`);
            console.log(`      Clock Out: ${record.clock_out_ist}`);
        });
        
        console.log('\n' + '='.repeat(70));
        console.log('✅ FIX COMPLETED SUCCESSFULLY!');
        console.log('='.repeat(70));
        
    } catch (error) {
        console.error('❌ Error fixing times:', error);
        console.error(error.stack);
    }
};

// Run the fix
fixRegularizationTimes()
    .then(() => {
        console.log('\n🎉 Script execution completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 Fatal error:', error);
        process.exit(1);
    });