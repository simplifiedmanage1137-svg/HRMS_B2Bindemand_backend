const supabase = require('../config/supabase');

const fixEmployeeB2B240801 = async () => {
    try {
        console.log('🔧 FIXING EMPLOYEE B2B240801 LATE MARKS');
        console.log('='.repeat(50));

        const employeeId = 'B2B240801';
        const today = new Date().toISOString().split('T')[0];

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

        console.log(`👤 Employee: ${employee.first_name} ${employee.last_name}`);
        console.log(`📋 Shift: ${employee.shift_timing}`);

        // Get today's attendance
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

        console.log(`📊 Current late_minutes: ${attendance.late_minutes}`);
        console.log(`📊 Current late_display: ${attendance.late_display}`);
        console.log(`🕐 Clock in: ${attendance.clock_in_ist || attendance.clock_in}`);

        // Parse shift timing - default to 9:30 AM if not found
        let shiftHour = 9, shiftMinute = 30; // Default for B2B240801
        
        if (employee.shift_timing) {
            const shiftString = employee.shift_timing.trim();
            let startTimeStr = shiftString.includes('-') ? shiftString.split('-')[0].trim() : shiftString;
            
            console.log(`🔍 Parsing shift: "${startTimeStr}"`);
            
            // Try AM/PM format
            const ampmMatch = startTimeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
            if (ampmMatch) {
                let hour = parseInt(ampmMatch[1]);
                const minute = parseInt(ampmMatch[2]);
                const ampm = ampmMatch[3].toUpperCase();
                
                if (ampm === 'PM' && hour !== 12) hour += 12;
                if (ampm === 'AM' && hour === 12) hour = 0;
                
                shiftHour = hour;
                shiftMinute = minute;
                console.log(`✅ Parsed shift time: ${hour}:${minute} ${ampm}`);
            }
        }

        console.log(`⏰ Final shift start time: ${shiftHour}:${shiftMinute.toString().padStart(2, '0')}`);

        // Parse clock in time
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

        console.log(`🕐 Parsed clock in time: ${clockInTime.toLocaleString()}`);

        // Create shift start time
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

        console.log(`⏰ Shift start time: ${shiftStartTime.toLocaleString()}`);

        // Calculate late time
        const diffMs = clockInTime - shiftStartTime;
        const isLate = diffMs > 0;
        
        console.log(`⚖️ Time difference: ${diffMs}ms (${(diffMs / (1000 * 60)).toFixed(2)} minutes)`);
        console.log(`⚖️ Is Late: ${isLate}`);

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

            console.log(`🚨 EMPLOYEE IS LATE!`);
            console.log(`📊 Late minutes: ${lateMinutes.toFixed(4)}`);
            console.log(`📊 Late display: "${lateDisplay}"`);

            // Update the record
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
                console.log('✅ RECORD UPDATED SUCCESSFULLY!');
                console.log(`✅ New late_minutes: ${lateMinutes.toFixed(4)}`);
                console.log(`✅ New late_display: "${lateDisplay}"`);
            }
        } else {
            console.log('✅ Employee is on time - no late mark needed');
        }

        console.log('='.repeat(50));
        console.log('🏁 FIX COMPLETED');

    } catch (error) {
        console.error('❌ Fix error:', error);
    }
};

// Run the fix
fixEmployeeB2B240801();