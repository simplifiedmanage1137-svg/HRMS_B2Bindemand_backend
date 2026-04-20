// Debug script to check late calculation for all employees
const supabase = require('./config/supabase');

// Format late time for display
const formatLateTime = (lateMinutes) => {
    if (!lateMinutes || lateMinutes <= 0) return null;
    const totalMinutes = lateMinutes;
    const hours = Math.floor(totalMinutes / 60);
    const remainingMinutes = Math.floor(totalMinutes % 60);
    const seconds = Math.round((totalMinutes - Math.floor(totalMinutes)) * 60);
    if (hours > 0) {
        if (remainingMinutes > 0 && seconds > 0) return `${hours}h ${remainingMinutes}m ${seconds}s`;
        if (remainingMinutes > 0) return `${hours}h ${remainingMinutes}m`;
        if (seconds > 0) return `${hours}h ${seconds}s`;
        return `${hours}h`;
    }
    if (remainingMinutes > 0) {
        if (seconds > 0) return `${remainingMinutes}m ${seconds}s`;
        return `${remainingMinutes}m`;
    }
    return `${seconds}s`;
};

// Parse shift timing
const parseShiftTiming = (shiftString) => {
    console.log(`🔍 Parsing shift: "${shiftString}"`);
    
    if (!shiftString) {
        console.log('❌ No shift timing provided, using default 9:00 AM');
        return { startHour: 9, startMinute: 0 };
    }
    
    let startTimeStr = shiftString.trim();
    
    // Extract start time from shift range
    if (startTimeStr.includes('-')) {
        startTimeStr = startTimeStr.split('-')[0].trim();
    }
    
    console.log(`🔍 Extracted start time: "${startTimeStr}"`);
    
    // Try multiple parsing patterns
    let parsed = false;
    let shiftHour = 9, shiftMinute = 0;
    
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
        console.log(`⚠️ Could not parse shift timing "${startTimeStr}", using default 9:00 AM`);
        shiftHour = 9;
        shiftMinute = 0;
    }
    
    return { startHour: shiftHour, startMinute: shiftMinute };
};

const debugLateCalculation = async () => {
    try {
        console.log('🚀 Starting late calculation debug...\n');
        
        // Get all employees
        const { data: employees, error: empError } = await supabase
            .from('employees')
            .select('employee_id, first_name, last_name, shift_timing')
            .order('employee_id');
            
        if (empError) {
            console.error('❌ Error fetching employees:', empError);
            return;
        }
        
        console.log(`📊 Found ${employees.length} employees\n`);
        
        // Get today's date
        const today = new Date().toISOString().split('T')[0];
        console.log(`📅 Checking attendance for: ${today}\n`);
        
        // Get today's attendance
        const { data: attendance, error: attError } = await supabase
            .from('attendance')
            .select('*')
            .eq('attendance_date', today)
            .order('employee_id');
            
        if (attError) {
            console.error('❌ Error fetching attendance:', attError);
            return;
        }
        
        console.log(`📊 Found ${attendance.length} attendance records for today\n`);
        
        // Create attendance map
        const attendanceMap = {};
        attendance.forEach(att => {
            attendanceMap[att.employee_id] = att;
        });
        
        console.log('=' * 80);
        console.log('EMPLOYEE SHIFT TIMING & LATE CALCULATION ANALYSIS');
        console.log('=' * 80);
        
        employees.forEach(emp => {
            console.log(`\n👤 Employee: ${emp.first_name} ${emp.last_name} (${emp.employee_id})`);
            console.log(`📋 Shift Timing: "${emp.shift_timing || 'Not Set'}"`);
            
            // Parse shift timing
            const shiftInfo = parseShiftTiming(emp.shift_timing);
            console.log(`⏰ Parsed Shift Start: ${shiftInfo.startHour.toString().padStart(2, '0')}:${shiftInfo.startMinute.toString().padStart(2, '0')}`);
            
            // Check today's attendance
            const todayAtt = attendanceMap[emp.employee_id];
            if (todayAtt) {
                console.log(`✅ Has attendance record:`);
                console.log(`   Clock In: ${todayAtt.clock_in_ist || todayAtt.clock_in}`);
                console.log(`   Late Minutes: ${todayAtt.late_minutes || 0}`);
                console.log(`   Late Display: ${todayAtt.late_display || 'None'}`);
                console.log(`   Status: ${todayAtt.status || 'Unknown'}`);
                
                // Recalculate late time if clock_in exists
                if (todayAtt.clock_in || todayAtt.clock_in_ist) {
                    const clockInTime = new Date(todayAtt.clock_in_ist || todayAtt.clock_in);
                    const shiftStartTime = new Date(clockInTime);
                    shiftStartTime.setHours(shiftInfo.startHour, shiftInfo.startMinute, 0, 0);
                    
                    const diffMs = clockInTime - shiftStartTime;
                    const isLate = diffMs > 60000; // 1 minute grace period
                    
                    if (isLate) {
                        const lateMinutes = diffMs / (1000 * 60);
                        const lateDisplay = formatLateTime(lateMinutes);
                        console.log(`🔄 Recalculated Late: ${lateDisplay} (${lateMinutes.toFixed(2)} minutes)`);
                        
                        if (todayAtt.late_display !== lateDisplay) {
                            console.log(`⚠️  MISMATCH! Stored: "${todayAtt.late_display}" vs Calculated: "${lateDisplay}"`);
                        }
                    } else {
                        console.log(`✅ On time (${Math.abs(diffMs / 1000)} seconds ${diffMs < 0 ? 'early' : 'after'} shift start)`);
                    }
                }
            } else {
                console.log(`❌ No attendance record for today`);
            }
            
            console.log('-'.repeat(60));
        });
        
        // Summary
        const lateEmployees = attendance.filter(att => att.late_minutes > 0);
        const missingLateDisplay = attendance.filter(att => att.late_minutes > 0 && !att.late_display);
        
        console.log(`\n📊 SUMMARY:`);
        console.log(`   Total Employees: ${employees.length}`);
        console.log(`   Present Today: ${attendance.length}`);
        console.log(`   Late Today: ${lateEmployees.length}`);
        console.log(`   Missing Late Display: ${missingLateDisplay.length}`);
        
        if (missingLateDisplay.length > 0) {
            console.log(`\n⚠️  EMPLOYEES WITH MISSING LATE DISPLAY:`);
            missingLateDisplay.forEach(att => {
                const emp = employees.find(e => e.employee_id === att.employee_id);
                console.log(`   - ${emp?.first_name} ${emp?.last_name} (${att.employee_id}): ${att.late_minutes} minutes late`);
            });
        }
        
    } catch (error) {
        console.error('❌ Debug script error:', error);
    }
};

// Run the debug script
debugLateCalculation().then(() => {
    console.log('\n✅ Debug script completed');
    process.exit(0);
}).catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
});