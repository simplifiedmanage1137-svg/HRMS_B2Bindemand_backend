const supabase = require('../config/supabase');

const debugEmployeeAttendance = async (employeeId) => {
    try {
        console.log('🔍 DEBUGGING EMPLOYEE ATTENDANCE');
        console.log('='.repeat(70));
        console.log(`Employee ID: ${employeeId}`);
        console.log(`Date: ${new Date().toISOString().split('T')[0]}`);
        console.log('='.repeat(70));

        // Get employee details
        const { data: employee, error: empError } = await supabase
            .from('employees')
            .select('*')
            .eq('employee_id', employeeId)
            .single();

        if (empError || !employee) {
            console.log('❌ Employee not found:', empError);
            return;
        }

        console.log('👤 EMPLOYEE DETAILS:');
        console.log(`Name: ${employee.first_name} ${employee.last_name}`);
        console.log(`Shift Timing: "${employee.shift_timing}"`);
        console.log(`Department: ${employee.department}`);

        // Get today's attendance
        const today = new Date().toISOString().split('T')[0];
        const { data: attendance, error: attError } = await supabase
            .from('attendance')
            .select('*')
            .eq('employee_id', employeeId)
            .eq('attendance_date', today)
            .single();

        if (attError || !attendance) {
            console.log('❌ No attendance record found for today:', attError);
            return;
        }

        console.log('\n📊 ATTENDANCE RECORD:');
        console.log(`ID: ${attendance.id}`);
        console.log(`Clock In: ${attendance.clock_in}`);
        console.log(`Clock In IST: ${attendance.clock_in_ist}`);
        console.log(`Late Minutes (stored): ${attendance.late_minutes}`);
        console.log(`Late Display (stored): ${attendance.late_display}`);
        console.log(`Shift Time Used: ${attendance.shift_time_used}`);

        // Parse shift timing
        let shiftHour = 9, shiftMinute = 0;
        const shiftString = employee.shift_timing || attendance.shift_time_used;
        
        console.log('\n⏰ SHIFT TIMING PARSING:');
        console.log(`Raw shift string: "${shiftString}"`);

        if (shiftString) {
            let startTimeStr = shiftString.trim();
            
            if (startTimeStr.includes('-')) {
                startTimeStr = startTimeStr.split('-')[0].trim();
            }
            
            console.log(`Extracted start time: "${startTimeStr}"`);
            
            let parsed = false;
            
            // Pattern 1: "9:00 AM" or "3:00 PM"
            const ampmMatch = startTimeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
            if (ampmMatch) {
                let hour = parseInt(ampmMatch[1]);
                const minute = parseInt(ampmMatch[2]);
                const ampm = ampmMatch[3].toUpperCase();
                
                if (ampm === 'PM' && hour !== 12) hour += 12;
                if (ampm === 'AM' && hour === 12) hour = 0;
                
                shiftHour = hour;
                shiftMinute = minute;
                parsed = true;
                console.log(`✅ Parsed AM/PM format: ${hour}:${minute} (${ampm})`);
            }
            
            // Pattern 2: "15:00" (24-hour format)
            if (!parsed) {
                const militaryMatch = startTimeStr.match(/(\d{1,2}):(\d{2})/);
                if (militaryMatch) {
                    shiftHour = parseInt(militaryMatch[1]);
                    shiftMinute = parseInt(militaryMatch[2]);
                    parsed = true;
                    console.log(`✅ Parsed 24-hour format: ${shiftHour}:${shiftMinute}`);
                }
            }
            
            // Pattern 3: Just hour "9" or "15"
            if (!parsed) {
                const hourMatch = startTimeStr.match(/^(\d{1,2})$/);
                if (hourMatch) {
                    shiftHour = parseInt(hourMatch[1]);
                    shiftMinute = 0;
                    parsed = true;
                    console.log(`✅ Parsed hour only: ${shiftHour}:00`);
                }
            }
            
            if (!parsed) {
                console.log(`⚠️ Could not parse shift timing, using default 9:00 AM`);
                shiftHour = 9;
                shiftMinute = 0;
            }
        }

        console.log(`Final shift time: ${shiftHour}:${shiftMinute.toString().padStart(2, '0')}`);

        // Parse clock in time
        let clockInTime;
        const clockInValue = attendance.clock_in_ist || attendance.clock_in;
        
        console.log('\n🕐 CLOCK IN TIME PARSING:');
        console.log(`Raw clock in value: "${clockInValue}"`);

        if (clockInValue && typeof clockInValue === 'string' && clockInValue.includes(' ')) {
            const [datePart, timePart] = clockInValue.split(' ');
            const [year, month, day] = datePart.split('-');
            const [hour, minute, second] = timePart.split(':');
            clockInTime = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second || 0));
            console.log(`✅ Parsed IST format: ${clockInTime.toLocaleString()}`);
        } else {
            clockInTime = new Date(clockInValue);
            console.log(`✅ Parsed as Date: ${clockInTime.toLocaleString()}`);
        }

        if (!clockInTime || isNaN(clockInTime.getTime())) {
            console.log('❌ Invalid clock in time');
            return;
        }

        // Create shift start time for today
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

        console.log('\n⚖️ LATE CALCULATION:');
        console.log(`Shift start time: ${shiftStartTime.toLocaleString()}`);
        console.log(`Clock in time: ${clockInTime.toLocaleString()}`);

        // Calculate late time
        const diffMs = clockInTime - shiftStartTime;
        const isLate = diffMs > 0;
        
        console.log(`Time difference (ms): ${diffMs}`);
        console.log(`Time difference (minutes): ${diffMs / (1000 * 60)}`);
        console.log(`Is Late: ${isLate}`);

        let lateMinutes = 0;
        let lateDisplay = null;

        if (isLate) {
            lateMinutes = diffMs / (1000 * 60);
            
            // Format late display
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

            console.log(`✅ CALCULATED LATE TIME:`);
            console.log(`Late minutes: ${lateMinutes.toFixed(4)}`);
            console.log(`Late display: "${lateDisplay}"`);
        } else {
            console.log(`✅ ON TIME - No late calculation needed`);
        }

        // Compare with stored values
        console.log('\n🔄 COMPARISON WITH STORED VALUES:');
        console.log(`Stored late_minutes: ${attendance.late_minutes}`);
        console.log(`Calculated late_minutes: ${lateMinutes.toFixed(4)}`);
        console.log(`Stored late_display: "${attendance.late_display}"`);
        console.log(`Calculated late_display: "${lateDisplay}"`);

        const needsUpdate = Math.abs((parseFloat(attendance.late_minutes) || 0) - lateMinutes) > 0.01 || 
                           attendance.late_display !== lateDisplay;

        console.log(`Needs update: ${needsUpdate}`);

        if (needsUpdate && isLate) {
            console.log('\n🔧 UPDATING RECORD...');
            
            const { error: updateError } = await supabase
                .from('attendance')
                .update({
                    late_minutes: parseFloat(lateMinutes.toFixed(4)),
                    late_display: lateDisplay
                })
                .eq('id', attendance.id);

            if (updateError) {
                console.log('❌ Update failed:', updateError);
            } else {
                console.log('✅ Record updated successfully!');
                console.log(`New late_minutes: ${lateMinutes.toFixed(4)}`);
                console.log(`New late_display: "${lateDisplay}"`);
            }
        } else if (!isLate) {
            console.log('\n✅ Employee is on time - no late mark needed');
        } else {
            console.log('\n✅ Record is already correct - no update needed');
        }

        console.log('\n='.repeat(70));
        console.log('🏁 DEBUG COMPLETED');
        console.log('='.repeat(70));

    } catch (error) {
        console.error('❌ Debug error:', error);
    }
};

// Run debug for specific employee
const employeeId = process.argv[2] || 'B2B240801';
debugEmployeeAttendance(employeeId);