const supabase = require('../config/supabase');

// Helper function to parse shift timing
const parseShiftTiming = (shiftString) => {
    if (!shiftString) {
        return { startHour: 9, startMinute: 0, endHour: 18, endMinute: 0, totalHours: 9 };
    }
    const parts = shiftString.split('-');
    if (parts.length !== 2) {
        return { startHour: 9, startMinute: 0, endHour: 18, endMinute: 0, totalHours: 9 };
    }
    const startPart = parts[0].trim();
    const endPart = parts[1].trim();
    const parseTime = (timeStr) => {
        const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (!match) return null;
        let hour = parseInt(match[1]);
        const minute = parseInt(match[2]);
        const ampm = match[3].toUpperCase();
        if (ampm === 'PM' && hour !== 12) hour += 12;
        if (ampm === 'AM' && hour === 12) hour = 0;
        return { hour, minute };
    };
    const startTime = parseTime(startPart);
    const endTime = parseTime(endPart);
    if (!startTime || !endTime) {
        return { startHour: 9, startMinute: 0, endHour: 18, endMinute: 0, totalHours: 9 };
    }
    const startTotalMinutes = (startTime.hour * 60) + startTime.minute;
    const endTotalMinutes = (endTime.hour * 60) + endTime.minute;
    let totalMinutes = endTotalMinutes - startTotalMinutes;
    if (totalMinutes < 0) totalMinutes += 24 * 60;
    return {
        startHour: startTime.hour,
        startMinute: startTime.minute,
        endHour: endTime.hour,
        endMinute: endTime.minute,
        totalHours: totalMinutes / 60
    };
};

// Parse shift timing with enhanced logic
const parseShiftTimingEnhanced = (shiftString) => {
    if (!shiftString) {
        return { startHour: 9, startMinute: 0 };
    }

    let startTimeStr = shiftString.trim();
    
    // Extract start time from shift range (e.g., "9:00 AM - 6:00 PM")
    if (startTimeStr.includes('-')) {
        startTimeStr = startTimeStr.split('-')[0].trim();
    }
    
    let shiftHour = 9, shiftMinute = 0;
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
    }
    
    // Pattern 2: "15:00" (24-hour format)
    if (!parsed) {
        const militaryMatch = startTimeStr.match(/(\d{1,2}):(\d{2})/);
        if (militaryMatch) {
            shiftHour = parseInt(militaryMatch[1]);
            shiftMinute = parseInt(militaryMatch[2]);
            parsed = true;
        }
    }
    
    // Pattern 3: Just hour "9" or "15"
    if (!parsed) {
        const hourMatch = startTimeStr.match(/^(\d{1,2})$/);
        if (hourMatch) {
            shiftHour = parseInt(hourMatch[1]);
            shiftMinute = 0;
            parsed = true;
        }
    }
    
    if (!parsed) {
        console.log(`⚠️ Could not parse shift timing "${startTimeStr}", using default 9:00 AM`);
        shiftHour = 9;
        shiftMinute = 0;
    }

    return { startHour: shiftHour, startMinute: shiftMinute };
};

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

// Parse IST datetime string to Date object
const parseISTDateTime = (datetimeStr) => {
    if (!datetimeStr) return null;
    
    if (typeof datetimeStr === 'string' && datetimeStr.includes(' ')) {
        const [datePart, timePart] = datetimeStr.split(' ');
        const [year, month, day] = datePart.split('-');
        const [hour, minute, second] = timePart.split(':');
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second || 0));
    }
    
    const parsed = new Date(datetimeStr);
    return isNaN(parsed.getTime()) ? null : parsed;
};

const updateHistoricalLateMarks = async () => {
    try {
        console.log('🚀 Starting historical late marks update...');
        console.log('='.repeat(70));

        // Get all attendance records with employee shift timing
        const { data: attendanceRecords, error: attendanceError } = await supabase
            .from('attendance')
            .select(`
                id,
                employee_id,
                attendance_date,
                clock_in,
                clock_in_ist,
                late_minutes,
                late_display,
                shift_time_used,
                employees!inner(shift_timing)
            `)
            .not('clock_in', 'is', null)
            .order('attendance_date', { ascending: false });

        if (attendanceError) {
            throw attendanceError;
        }

        console.log(`📊 Found ${attendanceRecords.length} attendance records to process`);

        let updatedCount = 0;
        let alreadyCorrectCount = 0;
        let errorCount = 0;

        for (const record of attendanceRecords) {
            try {
                // Parse clock in time
                let clockInTime;
                const clockInValue = record.clock_in_ist || record.clock_in;
                
                if (clockInValue) {
                    clockInTime = parseISTDateTime(clockInValue);
                    if (!clockInTime) {
                        clockInTime = new Date(clockInValue);
                    }
                }

                if (!clockInTime || isNaN(clockInTime.getTime())) {
                    console.log(`⚠️ Invalid clock in time for record ${record.id}: ${clockInValue}`);
                    errorCount++;
                    continue;
                }

                // Get shift timing
                const shiftTiming = parseShiftTimingEnhanced(record.employees?.shift_timing || record.shift_time_used);
                
                // Create shift start time for the attendance date
                const attendanceDate = new Date(record.attendance_date);
                const shiftStartTime = new Date(
                    attendanceDate.getFullYear(),
                    attendanceDate.getMonth(),
                    attendanceDate.getDate(),
                    shiftTiming.startHour,
                    shiftTiming.startMinute,
                    0,
                    0
                );

                // Calculate late time
                const diffMs = clockInTime - shiftStartTime;
                const isLate = diffMs > 0; // Any delay is late
                
                let lateMinutes = 0;
                let lateDisplay = null;

                if (isLate) {
                    lateMinutes = diffMs / (1000 * 60);
                    lateDisplay = formatLateTime(lateMinutes);
                }

                const lateMinutesToSave = isLate ? parseFloat(lateMinutes.toFixed(4)) : 0;

                // Check if update is needed
                const currentLateMinutes = parseFloat(record.late_minutes) || 0;
                const needsUpdate = Math.abs(currentLateMinutes - lateMinutesToSave) > 0.01 || 
                                  record.late_display !== lateDisplay;

                if (needsUpdate) {
                    // Update the record
                    const { error: updateError } = await supabase
                        .from('attendance')
                        .update({
                            late_minutes: lateMinutesToSave,
                            late_display: lateDisplay
                        })
                        .eq('id', record.id);

                    if (updateError) {
                        console.error(`❌ Error updating record ${record.id}:`, updateError);
                        errorCount++;
                    } else {
                        updatedCount++;
                        if (isLate) {
                            console.log(`✅ Updated ${record.employee_id} (${record.attendance_date}): Late ${lateDisplay}`);
                        }
                    }
                } else {
                    alreadyCorrectCount++;
                }

            } catch (recordError) {
                console.error(`❌ Error processing record ${record.id}:`, recordError);
                errorCount++;
            }
        }

        console.log('='.repeat(70));
        console.log('📈 HISTORICAL LATE MARKS UPDATE COMPLETED');
        console.log(`✅ Updated records: ${updatedCount}`);
        console.log(`✓ Already correct: ${alreadyCorrectCount}`);
        console.log(`❌ Errors: ${errorCount}`);
        console.log(`📊 Total processed: ${attendanceRecords.length}`);
        console.log('='.repeat(70));

        return {
            success: true,
            totalRecords: attendanceRecords.length,
            updatedCount,
            alreadyCorrectCount,
            errorCount
        };

    } catch (error) {
        console.error('❌ Fatal error in updateHistoricalLateMarks:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

// Run the update if this script is executed directly
if (require.main === module) {
    updateHistoricalLateMarks()
        .then(result => {
            console.log('Script completed:', result);
            process.exit(result.success ? 0 : 1);
        })
        .catch(error => {
            console.error('Script failed:', error);
            process.exit(1);
        });
}

module.exports = { updateHistoricalLateMarks };