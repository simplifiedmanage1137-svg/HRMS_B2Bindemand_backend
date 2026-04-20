const supabase = require('../config/supabase');

const immediateFixB2B240801 = async () => {
    try {
        console.log('🚨 IMMEDIATE FIX FOR EMPLOYEE B2B240801');
        console.log('='.repeat(60));

        const employeeId = 'B2B240801';
        const today = new Date().toISOString().split('T')[0];

        // Step 1: Get employee details
        console.log('📋 Step 1: Getting employee details...');
        const { data: employee, error: empError } = await supabase
            .from('employees')
            .select('*')
            .eq('employee_id', employeeId)
            .single();

        if (empError || !employee) {
            console.log('❌ Employee not found:', empError);
            return;
        }

        console.log(`👤 Employee: ${employee.first_name} ${employee.last_name}`);
        console.log(`📋 Shift Timing: "${employee.shift_timing}"`);

        // Step 2: Get today's attendance record
        console.log('\n📋 Step 2: Getting today\'s attendance...');
        const { data: attendance, error: attError } = await supabase
            .from('attendance')
            .select('*')
            .eq('employee_id', employeeId)
            .eq('attendance_date', today)
            .single();

        if (attError || !attendance) {
            console.log('❌ No attendance record found for today');
            return;
        }

        console.log(`📊 Current Record ID: ${attendance.id}`);
        console.log(`🕐 Clock In: ${attendance.clock_in_ist || attendance.clock_in}`);
        console.log(`📊 Current late_minutes: ${attendance.late_minutes}`);
        console.log(`📊 Current late_display: "${attendance.late_display}"`);

        // Step 3: Parse shift timing (default to 9:30 AM for B2B240801)
        console.log('\n📋 Step 3: Parsing shift timing...');
        let shiftHour = 9, shiftMinute = 30; // Default for this employee
        
        if (employee.shift_timing) {
            const shiftString = employee.shift_timing.trim();
            let startTimeStr = shiftString.includes('-') ? shiftString.split('-')[0].trim() : shiftString;
            
            console.log(`🔍 Parsing: "${startTimeStr}"`);
            
            const ampmMatch = startTimeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
            if (ampmMatch) {
                let hour = parseInt(ampmMatch[1]);
                const minute = parseInt(ampmMatch[2]);
                const ampm = ampmMatch[3].toUpperCase();
                
                if (ampm === 'PM' && hour !== 12) hour += 12;
                if (ampm === 'AM' && hour === 12) hour = 0;
                
                shiftHour = hour;
                shiftMinute = minute;
                console.log(`✅ Parsed: ${hour}:${minute} ${ampm}`);
            } else {
                console.log(`⚠️ Using default: 9:30 AM`);
            }
        }

        console.log(`⏰ Final shift start time: ${shiftHour}:${shiftMinute.toString().padStart(2, '0')}`);

        // Step 4: Parse clock in time
        console.log('\n📋 Step 4: Parsing clock in time...');
        let clockInTime;
        const clockInValue = attendance.clock_in_ist || attendance.clock_in;
        
        if (clockInValue && typeof clockInValue === 'string' && clockInValue.includes(' ')) {
            const [datePart, timePart] = clockInValue.split(' ');
            const [year, month, day] = datePart.split('-');
            const [hour, minute, second] = timePart.split(':');
            clockInTime = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second || 0));
        } else {
            clockInTime = new Date(clockInValue);
        }

        console.log(`🕐 Parsed clock in: ${clockInTime.toLocaleString()}`);

        // Step 5: Calculate late time
        console.log('\n📋 Step 5: Calculating late time...');
        const attendanceDate = new Date(attendance.attendance_date);
        const shiftStartTime = new Date(
            attendanceDate.getFullYear(),
            attendanceDate.getMonth(),
            attendanceDate.getDate(),
            shiftHour,
            shiftMinute,
            0,
            0
        );

        console.log(`⏰ Shift start: ${shiftStartTime.toLocaleString()}`);
        console.log(`🕐 Clock in: ${clockInTime.toLocaleString()}`);

        const diffMs = clockInTime - shiftStartTime;
        const isLate = diffMs > 0;
        
        console.log(`⚖️ Time difference: ${diffMs}ms (${(diffMs / (1000 * 60)).toFixed(2)} minutes)`);
        console.log(`🚨 Is Late: ${isLate}`);

        let lateMinutes = 0;
        let lateDisplay = null;

        if (isLate) {
            lateMinutes = diffMs / (1000 * 60);
            
            const totalSeconds = Math.floor(diffMs / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const remainingSeconds = totalSeconds % 3600;
            const minutes = Math.floor(remainingSeconds / 60);
            const seconds = remainingSeconds % 60;

            const parts = [];
            if (hours > 0) parts.push(`${hours}h`);
            if (minutes > 0) parts.push(`${minutes}m`);
            if (seconds > 0 || (hours === 0 && minutes === 0)) parts.push(`${seconds}s`);
            lateDisplay = parts.join(' ');

            console.log(`🚨 CALCULATED LATE TIME:`);
            console.log(`📊 Late minutes: ${lateMinutes.toFixed(4)}`);
            console.log(`📊 Late display: "${lateDisplay}"`);

            // Step 6: Update the database record
            console.log('\n📋 Step 6: Updating database record...');
            const { error: updateError } = await supabase
                .from('attendance')
                .update({
                    late_minutes: parseFloat(lateMinutes.toFixed(4)),
                    late_display: lateDisplay
                })
                .eq('id', attendance.id);

            if (updateError) {
                console.log('❌ Database update failed:', updateError);
            } else {
                console.log('✅ DATABASE UPDATED SUCCESSFULLY!');
                console.log(`✅ New late_minutes: ${lateMinutes.toFixed(4)}`);
                console.log(`✅ New late_display: "${lateDisplay}"`);
            }

            // Step 7: Verify the update
            console.log('\n📋 Step 7: Verifying update...');
            const { data: updatedRecord } = await supabase
                .from('attendance')
                .select('late_minutes, late_display')
                .eq('id', attendance.id)
                .single();

            if (updatedRecord) {
                console.log('✅ VERIFICATION SUCCESSFUL:');
                console.log(`📊 Stored late_minutes: ${updatedRecord.late_minutes}`);
                console.log(`📊 Stored late_display: "${updatedRecord.late_display}"`);
            }

        } else {
            console.log('✅ Employee is on time - no late mark needed');
        }

        console.log('\n='.repeat(60));
        console.log('🎉 IMMEDIATE FIX COMPLETED');
        console.log('='.repeat(60));
        
        if (isLate) {
            console.log('📱 NEXT STEPS:');
            console.log('1. Refresh Admin Dashboard');
            console.log('2. Check Live Attendance Feed');
            console.log('3. Check Attendance Reports page');
            console.log('4. Late marks should now be visible!');
        }

    } catch (error) {
        console.error('❌ Immediate fix error:', error);
    }
};

// Run the immediate fix
immediateFixB2B240801();