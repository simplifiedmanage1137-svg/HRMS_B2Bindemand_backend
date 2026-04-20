#!/usr/bin/env node

// Comprehensive fix for late marks issue
// This will run the historical update and then specifically check employee B2B240801

const { updateHistoricalLateMarks } = require('./update-historical-late-marks');
const supabase = require('../config/supabase');

const checkSpecificEmployee = async (employeeId) => {
    try {
        console.log(`\n🔍 CHECKING SPECIFIC EMPLOYEE: ${employeeId}`);
        console.log('='.repeat(50));

        const today = new Date().toISOString().split('T')[0];

        // Get employee and attendance data
        const { data: employee } = await supabase
            .from('employees')
            .select('*')
            .eq('employee_id', employeeId)
            .single();

        const { data: attendance } = await supabase
            .from('attendance')
            .select('*')
            .eq('employee_id', employeeId)
            .eq('attendance_date', today)
            .single();

        if (!employee || !attendance) {
            console.log('❌ Employee or attendance not found');
            return;
        }

        console.log(`👤 ${employee.first_name} ${employee.last_name}`);
        console.log(`📋 Shift: ${employee.shift_timing}`);
        console.log(`🕐 Clock In: ${attendance.clock_in_ist || attendance.clock_in}`);
        console.log(`📊 Late Minutes: ${attendance.late_minutes}`);
        console.log(`📊 Late Display: ${attendance.late_display}`);

        // Force recalculation
        let shiftHour = 9, shiftMinute = 30; // Default
        
        if (employee.shift_timing) {
            const shiftString = employee.shift_timing.trim();
            let startTimeStr = shiftString.includes('-') ? shiftString.split('-')[0].trim() : shiftString;
            
            const ampmMatch = startTimeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
            if (ampmMatch) {
                let hour = parseInt(ampmMatch[1]);
                const minute = parseInt(ampmMatch[2]);
                const ampm = ampmMatch[3].toUpperCase();
                
                if (ampm === 'PM' && hour !== 12) hour += 12;
                if (ampm === 'AM' && hour === 12) hour = 0;
                
                shiftHour = hour;
                shiftMinute = minute;
            }
        }

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

        const diffMs = clockInTime - shiftStartTime;
        const isLate = diffMs > 0;
        
        console.log(`⏰ Shift Start: ${shiftStartTime.toLocaleString()}`);
        console.log(`🕐 Clock In: ${clockInTime.toLocaleString()}`);
        console.log(`⚖️ Difference: ${(diffMs / (1000 * 60)).toFixed(2)} minutes`);
        console.log(`🚨 Is Late: ${isLate}`);

        if (isLate) {
            const lateMinutes = diffMs / (1000 * 60);
            const totalSeconds = Math.floor(diffMs / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const remainingSeconds = totalSeconds % 3600;
            const minutes = Math.floor(remainingSeconds / 60);
            const seconds = remainingSeconds % 60;

            const parts = [];
            if (hours > 0) parts.push(`${hours}h`);
            if (minutes > 0) parts.push(`${minutes}m`);
            if (seconds > 0 || (hours === 0 && minutes === 0)) parts.push(`${seconds}s`);
            const lateDisplay = parts.join(' ');

            console.log(`🔧 SHOULD BE: Late ${lateDisplay} (${lateMinutes.toFixed(4)} minutes)`);

            // Update if needed
            const needsUpdate = Math.abs((parseFloat(attendance.late_minutes) || 0) - lateMinutes) > 0.01 || 
                               attendance.late_display !== lateDisplay;

            if (needsUpdate) {
                console.log('🔄 UPDATING RECORD...');
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
                }
            } else {
                console.log('✅ Record is already correct');
            }
        } else {
            console.log('✅ Employee is on time');
        }

    } catch (error) {
        console.error('❌ Error checking employee:', error);
    }
};

const runComprehensiveFix = async () => {
    try {
        console.log('🚀 COMPREHENSIVE LATE MARKS FIX');
        console.log('='.repeat(70));

        // Step 1: Run historical update
        console.log('📋 STEP 1: Running historical update for all employees...');
        const result = await updateHistoricalLateMarks();
        
        if (result.success) {
            console.log(`✅ Historical update completed: ${result.updatedCount} records updated`);
        } else {
            console.log(`❌ Historical update failed: ${result.error}`);
        }

        // Step 2: Check specific employee
        console.log('\n📋 STEP 2: Checking specific employee B2B240801...');
        await checkSpecificEmployee('B2B240801');

        // Step 3: Test the API endpoint
        console.log('\n📋 STEP 3: Testing getTodayAttendance API...');
        try {
            const response = await fetch('http://localhost:5000/api/attendance/today/B2B240801');
            const data = await response.json();
            
            if (data.success && data.attendance) {
                console.log('📊 API Response:');
                console.log(`   Late Minutes: ${data.attendance.late_minutes}`);
                console.log(`   Late Display: ${data.attendance.late_display}`);
                console.log(`   Is Late: ${data.attendance.is_late}`);
            } else {
                console.log('❌ API call failed or no attendance data');
            }
        } catch (apiError) {
            console.log('⚠️ Could not test API (server may not be running)');
        }

        console.log('\n='.repeat(70));
        console.log('🏁 COMPREHENSIVE FIX COMPLETED');
        console.log('='.repeat(70));

    } catch (error) {
        console.error('❌ Comprehensive fix error:', error);
    }
};

// Run the comprehensive fix
runComprehensiveFix()
    .then(() => {
        console.log('\n✅ All fixes completed successfully!');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ Fix failed:', error);
        process.exit(1);
    });