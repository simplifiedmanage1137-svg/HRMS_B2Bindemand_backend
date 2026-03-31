const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { holidays } = require('../data/holidays');

// Generate unique session ID
const generateSessionId = () => {
    return uuidv4();
};

// Helper function to calculate time difference in minutes
const calculateTimeDifferenceInMinutes = (date1, date2) => {
    const diffMs = Math.abs(date2 - date1);
    const diffMinutes = diffMs / (1000 * 60);
    return diffMinutes;
};

// Helper function to parse time string
const parseTimeString = (timeStr) => {
    if (!timeStr) return null;
    const ampmMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (ampmMatch) {
        let hour = parseInt(ampmMatch[1]);
        const minute = parseInt(ampmMatch[2]);
        const ampm = ampmMatch[3].toUpperCase();
        if (ampm === 'PM' && hour !== 12) hour += 12;
        if (ampm === 'AM' && hour === 12) hour = 0;
        return { hour, minute };
    }
    const militaryMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (militaryMatch) {
        return { hour: parseInt(militaryMatch[1]), minute: parseInt(militaryMatch[2]) };
    }
    return { hour: 9, minute: 0 };
};

// Parse shift timing
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

// Calculate overtime
const calculateOvertime = (totalHours, shiftHours) => {
    const standardShiftHours = shiftHours || 9;
    const overtimeHours = Math.floor(Math.max(0, totalHours - standardShiftHours));
    return {
        overtimeHours,
        overtimeMinutes: overtimeHours * 60,
        hasOvertime: overtimeHours > 0,
        overtimeAmount: overtimeHours * 150
    };
};

// Local datetime parser
const parseLocalDateTime = (datetime) => {
    if (!datetime) return null;
    if (datetime instanceof Date) return datetime;

    let value = String(datetime).trim();
    if (value === '') return null;

    if (value.includes(' ')) {
        value = value.replace(' ', 'T');
    }

    const hasTZOffset = /[Zz]|[+-]\d{2}:?\d{2}$/.test(value);
    if (hasTZOffset) {
        const parsed = new Date(value);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    const [datePart, timePart] = value.split('T');
    if (!datePart || !timePart) {
        const parsed = new Date(value);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute, second = '0'] = timePart.split(':');
    if (![year, month, day].every(Number.isFinite)) {
        return null;
    }

    const localDate = new Date(year, month - 1, day, Number(hour) || 0, Number(minute) || 0, Number(second) || 0);
    return isNaN(localDate.getTime()) ? null : localDate;
};

// Convert IST local date string to UTC Date object
const parseISTDateTimeToUTC = (istDateTimeStr) => {
    if (!istDateTimeStr) return null;
    let value = String(istDateTimeStr).trim();
    if (!value) return null;

    value = value.replace('T', ' ').replace(/Z$/, '').replace(/[+-]\d{2}:?\d{2}$/, '').trim();

    const [datePart, timePart] = value.split(' ');
    if (!datePart || !timePart) return null;

    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute, second = '0'] = timePart.split(':').map(Number);

    if (![year, month, day, hour, minute].every(Number.isFinite)) return null;

    const istMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const utcMs = istMs - (5.5 * 60 * 60 * 1000);
    const utcDate = new Date(utcMs);
    return isNaN(utcDate.getTime()) ? null : utcDate;
};

// Convert UTC Date object to IST string
const formatUTCDateToISTString = (utcDate) => {
    if (!(utcDate instanceof Date) || isNaN(utcDate.getTime())) return null;
    const ist = new Date(utcDate.getTime() + (5.5 * 60 * 60 * 1000));
    const y = ist.getUTCFullYear();
    const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const d = String(ist.getUTCDate()).padStart(2, '0');
    const hh = String(ist.getUTCHours()).padStart(2, '0');
    const mm = String(ist.getUTCMinutes()).padStart(2, '0');
    const ss = String(ist.getUTCSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
};

// Check if a date is a holiday
const isHoliday = (date) => {
    const dateStr = date.toISOString().split('T')[0];
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return { isHoliday: true, type: 'weekly_off', name: dayOfWeek === 0 ? 'Sunday' : 'Saturday' };
    }
    const holiday = holidays.find(h => h.date === dateStr);
    if (holiday) {
        return { isHoliday: true, type: 'public_holiday', name: holiday.name, region: holiday.region };
    }
    return { isHoliday: false };
};

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

// Auto-close stale sessions
exports.autoCloseStaleSessions = async () => {
    try {
        console.log('🕐 Running auto-close stale sessions check...');
        const cutoffTime = new Date();
        cutoffTime.setHours(cutoffTime.getHours() - 24);
        const { data: staleSessions, error: sessionError } = await supabase
            .from('attendance_sessions')
            .select('*, employees(shift_timing)')
            .eq('is_active', true)
            .lt('clock_in_time', cutoffTime.toISOString());
        if (sessionError) throw sessionError;
        let closedCount = 0;
        for (const session of staleSessions || []) {
            const { data: attendanceRecords } = await supabase
                .from('attendance')
                .select('*')
                .eq('employee_id', session.employee_id)
                .eq('session_id', session.session_id)
                .is('clock_out', null);
            if (attendanceRecords && attendanceRecords.length > 0) {
                const attendance = attendanceRecords[0];
                const clockInTime = new Date(attendance.clock_in);
                const shiftTiming = parseShiftTiming(session.employees?.shift_timing);
                const shiftEndTime = new Date(clockInTime);
                shiftEndTime.setHours(shiftTiming.endHour, shiftTiming.endMinute, 0, 0);
                let autoClockOutTime = shiftEndTime;
                if (autoClockOutTime > new Date()) {
                    autoClockOutTime = new Date(clockInTime);
                    autoClockOutTime.setHours(autoClockOutTime.getHours() + 24);
                }
                const totalMinutes = calculateTimeDifferenceInMinutes(clockInTime, autoClockOutTime);
                const totalHours = totalMinutes / 60;
                let status = 'half_day';
                if (totalMinutes >= 480) status = 'present';
                else if (totalMinutes < 240) status = 'absent';

                const clockOutIST = autoClockOutTime.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });

                await supabase
                    .from('attendance')
                    .update({
                        clock_out: autoClockOutTime.toISOString(),
                        clock_out_ist: clockOutIST,
                        total_hours: Math.round(totalHours * 100) / 100,
                        total_minutes: Math.round(totalMinutes),
                        status: status,
                        auto_closed: true
                    })
                    .eq('id', attendance.id);
                await supabase
                    .from('attendance_sessions')
                    .update({ is_active: false, clock_out_time: autoClockOutTime.toISOString() })
                    .eq('id', session.id);
                closedCount++;
            }
        }
        return { success: true, closedCount };
    } catch (error) {
        console.error('Error auto-closing stale sessions:', error);
        return { success: false, error: error.message };
    }
};

// Clock In function
exports.clockIn = async (req, res) => {
    try {
        const { employee_id, latitude, longitude, accuracy } = req.body;
        if (!employee_id) {
            return res.status(400).json({ success: false, message: 'Employee ID is required' });
        }
        const { data: employees } = await supabase
            .from('employees')
            .select('*')
            .eq('employee_id', employee_id);
        if (!employees || employees.length === 0) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }
        const emp = employees[0];

        // Check for existing active session
        const { data: activeSessions } = await supabase
            .from('attendance_sessions')
            .select('*')
            .eq('employee_id', employee_id)
            .eq('is_active', true);

        if (activeSessions && activeSessions.length > 0) {
            const activeSession = activeSessions[0];
            const sessionDate = new Date(activeSession.clock_in_time);
            const today = new Date();
            if (sessionDate.toISOString().split('T')[0] !== today.toISOString().split('T')[0]) {
                // Auto-close stale session
                const { data: attendanceRecords } = await supabase
                    .from('attendance')
                    .select('*')
                    .eq('employee_id', employee_id)
                    .eq('session_id', activeSession.session_id)
                    .is('clock_out', null);
                if (attendanceRecords && attendanceRecords.length > 0) {
                    const attendance = attendanceRecords[0];
                    const clockInTime = new Date(attendance.clock_in);
                    const autoCloseTime = new Date(clockInTime);
                    autoCloseTime.setHours(23, 59, 59, 999);
                    const totalMinutes = calculateTimeDifferenceInMinutes(clockInTime, autoCloseTime);
                    const totalHours = totalMinutes / 60;
                    await supabase
                        .from('attendance')
                        .update({
                            clock_out: autoCloseTime.toISOString(),
                            total_hours: Math.round(totalHours * 100) / 100,
                            total_minutes: Math.round(totalMinutes),
                            status: totalMinutes >= 480 ? 'present' : 'half_day',
                            auto_closed: true
                        })
                        .eq('id', attendance.id);
                }
                await supabase
                    .from('attendance_sessions')
                    .update({ is_active: false, clock_out_time: new Date().toISOString() })
                    .eq('id', activeSession.id);
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'You have already clocked in today. Please clock out first.'
                });
            }
        }

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const today = `${year}-${month}-${day}`;
        const sessionId = generateSessionId();
        const holidayCheck = isHoliday(now);

        // Get shift timing
        let shiftHour = 9, shiftMinute = 0;
        let shiftDisplay = emp.shift_timing || '9:00 AM';

        if (emp.shift_timing) {
            let startTimeStr = emp.shift_timing;
            if (startTimeStr.includes('-')) {
                startTimeStr = startTimeStr.split('-')[0].trim();
            }

            const timeMatch = startTimeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
            if (timeMatch) {
                let hour = parseInt(timeMatch[1]);
                const minute = parseInt(timeMatch[2]);
                const ampm = timeMatch[3].toUpperCase();

                if (ampm === 'PM' && hour !== 12) hour += 12;
                if (ampm === 'AM' && hour === 12) hour = 0;
                shiftHour = hour;
                shiftMinute = minute;
            } else {
                const militaryMatch = startTimeStr.match(/(\d{1,2}):(\d{2})/);
                if (militaryMatch) {
                    shiftHour = parseInt(militaryMatch[1]);
                    shiftMinute = parseInt(militaryMatch[2]);
                }
            }
        }

        const shiftStartTime = new Date(year, now.getMonth(), now.getDate(), shiftHour, shiftMinute, 0, 0);
        const diffMs = now - shiftStartTime;
        const isLate = diffMs > 0;
        const isEarly = diffMs < 0;

        let lateMinutes = 0, earlyMinutes = 0;
        let lateDisplay = null;

        if (isLate) {
            lateMinutes = diffMs / (1000 * 60);
            const totalSeconds = Math.floor(lateMinutes * 60);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;

            if (minutes === 0) {
                lateDisplay = `${seconds}s`;
            } else if (seconds === 0) {
                lateDisplay = `${minutes}m`;
            } else {
                lateDisplay = `${minutes}m ${seconds}s`;
            }
        } else if (isEarly) {
            earlyMinutes = Math.abs(diffMs) / (1000 * 60);
        }

        const lateMinutesToSave = isLate ? parseFloat(lateMinutes.toFixed(2)) : 0;
        const earlyMinutesToSave = isEarly ? parseFloat(earlyMinutes.toFixed(2)) : 0;

        // Check for existing attendance
        const { data: existingAttendance } = await supabase
            .from('attendance')
            .select('*')
            .eq('employee_id', employee_id)
            .eq('attendance_date', today)
            .limit(1);

        if (existingAttendance && existingAttendance.length > 0) {
            if (existingAttendance[0].clock_in && !existingAttendance[0].clock_out) {
                return res.status(400).json({
                    success: false,
                    message: 'You have an incomplete attendance record from today. Please clock out or request regularization.',
                    has_missed_clockout: true,
                    attendance_id: existingAttendance[0].id
                });
            }
            return res.status(400).json({ success: false, message: 'You have already clocked in today' });
        }

        // Create IST time string
        const istTime = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
        const [datePart, timePart] = istTime.split(', ');
        const [istMonth, istDay, istYear] = datePart.split('/');
        const istDateStr = `${istYear}-${istMonth.padStart(2, '0')}-${istDay.padStart(2, '0')}`;
        const clockInIST = `${istDateStr} ${timePart}`;

        // Insert attendance record
        const { data: insertedAttendance, error: insertError } = await supabase
            .from('attendance')
            .insert([{
                employee_id,
                attendance_date: today,
                clock_in: now.toISOString(),
                clock_in_ist: clockInIST,
                late_minutes: lateMinutesToSave,
                early_minutes: earlyMinutesToSave,
                latitude: latitude || null,
                longitude: longitude || null,
                location_accuracy: accuracy || null,
                session_id: sessionId,
                shift_time_used: shiftDisplay,
                is_holiday: holidayCheck.isHoliday,
                holiday_name: holidayCheck.name || null
            }])
            .select();

        if (insertError) {
            console.error('❌ Insert error:', insertError);
            throw insertError;
        }

        // Create session
        await supabase.from('attendance_sessions').insert([{
            employee_id,
            session_id: sessionId,
            clock_in_time: now.toISOString(),
            last_heartbeat: now.toISOString(),
            is_active: true,
            latitude: latitude || null,
            longitude: longitude || null,
            location_accuracy: accuracy || null
        }]);

        let message = '✅ Clocked in on time';
        if (isLate) message = `⚠️ Clocked in (${lateDisplay} late)`;
        else if (isEarly) message = `⏰ Clocked in (${Math.floor(earlyMinutes)}m early)`;

        const response = {
            success: true,
            message,
            clock_in: now,
            clock_in_ist: clockInIST,
            shift_time: shiftDisplay,
            shift_start: `${shiftHour.toString().padStart(2, '0')}:${shiftMinute.toString().padStart(2, '0')}`,
            is_late: isLate,
            is_early: isEarly,
            late_minutes: lateMinutesToSave,
            late_display: lateDisplay,
            session_id: sessionId,
            employee_name: `${emp.first_name} ${emp.last_name}`,
            attendance_date: today,
            is_holiday: holidayCheck.isHoliday
        };

        res.json(response);

    } catch (error) {
        console.error('❌ Clock-in error:', error);
        res.status(500).json({ success: false, message: 'Failed to clock in', error: error.message });
    }
};

// Clock Out function
exports.clockOut = async (req, res) => {
    try {
        console.log('📍 CLOCK-OUT REQUEST START');
        const { employee_id, session_id } = req.body;

        if (!employee_id) {
            return res.status(400).json({
                success: false,
                message: 'Employee ID is required'
            });
        }

        let finalSessionId = session_id;
        const now = new Date();
        const startTime = Date.now();

        if (session_id) {
            const { data: session, error: sessionError } = await supabase
                .from('attendance_sessions')
                .select('is_active, clock_out_time')
                .eq('session_id', session_id)
                .eq('employee_id', employee_id)
                .single();

            if (sessionError) {
                console.error('Session error:', sessionError);
            }

            if (session && !session.is_active) {
                return res.status(400).json({
                    success: false,
                    message: 'This session has already been closed. Please refresh the page and try again.'
                });
            }
        }

        // If no session_id provided, find the active session for this employee
        if (!finalSessionId) {
            console.log('🔍 No session_id provided, looking for active session...');
            const { data: activeSessions, error: sessionError } = await supabase
                .from('attendance_sessions')
                .select('session_id')
                .eq('employee_id', employee_id)
                .eq('is_active', true)
                .order('created_at', { ascending: false })
                .limit(1);

            if (sessionError) {
                console.error('❌ Session lookup error:', sessionError);
                return res.status(400).json({
                    success: false,
                    message: 'Session ID is required and could not be found'
                });
            }

            if (!activeSessions || activeSessions.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No active session found. Please clock in first.'
                });
            }

            finalSessionId = activeSessions[0].session_id;
            console.log(`✅ Found active session: ${finalSessionId}`);
        }

        // Fetch attendance record with employee data
        console.log('⏱️ Fetching attendance record...');
        const { data: attendanceRecords, error: attendanceError } = await supabase
            .from('attendance')
            .select('id, employee_id, session_id, clock_in, clock_in_ist, attendance_date, employees!inner(shift_timing)')
            .eq('employee_id', employee_id)
            .eq('session_id', finalSessionId)
            .is('clock_out', null)
            .order('clock_in', { ascending: false })
            .limit(1);

        if (attendanceError) {
            console.error('❌ Attendance query error:', attendanceError);
            throw attendanceError;
        }

        if (!attendanceRecords || attendanceRecords.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No active attendance record found for this session'
            });
        }

        const attendanceRecord = attendanceRecords[0];
        const employee = attendanceRecord.employees;
        const queryTime = Date.now() - startTime;
        console.log(`✅ Query time: ${queryTime}ms`);

        // Calculate times
        const clockInTime = new Date(attendanceRecord.clock_in);
        const totalMinutes = (now - clockInTime) / (1000 * 60);
        const totalHours = totalMinutes / 60;

        const shiftTiming = parseShiftTiming(employee?.shift_timing);

        let status = 'half_day';
        if (totalMinutes >= 480) status = 'present';
        else if (totalMinutes < 240) status = 'absent';

        // Format IST time
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istTime = new Date(now.getTime() + istOffset);
        const istDateStr = istTime.toISOString().split('T')[0];
        const istTimeStr = istTime.toISOString().split('T')[1].split('.')[0];
        const clockOutIST = `${istDateStr} ${istTimeStr}`;

        const overtime = calculateOvertime(totalHours, shiftTiming.totalHours);

        // Update attendance record
        const updateData = {
            clock_out: now.toISOString(),
            clock_out_ist: clockOutIST,
            total_hours: Math.round(totalHours * 100) / 100,
            total_minutes: Math.round(totalMinutes),
            total_hours_display: `${Math.floor(totalMinutes / 60)}h ${Math.round(totalMinutes % 60)}m`,
            status: status
        };

        // Add overtime fields if they exist in the table
        try {
            updateData.overtime_hours = overtime.overtimeHours;
            updateData.overtime_minutes = overtime.overtimeMinutes;
            updateData.overtime_amount = overtime.overtimeAmount;
            updateData.has_overtime = overtime.hasOvertime;
        } catch (err) {
            console.log('⚠️ Overtime columns may not exist, skipping...');
        }

        console.log('⏱️ Updating attendance record...');
        const { error: updateError } = await supabase
            .from('attendance')
            .update(updateData)
            .eq('id', attendanceRecord.id);

        if (updateError) {
            console.error('❌ Error updating attendance:', updateError);
            throw updateError;
        }

        // Update session as inactive
        console.log('⏱️ Updating session...');
        const { error: sessionError } = await supabase
            .from('attendance_sessions')
            .update({
                is_active: false,
                clock_out_time: now.toISOString()
            })
            .eq('session_id', finalSessionId)
            .eq('employee_id', employee_id);

        if (sessionError) {
            console.error('❌ Error updating session:', sessionError);
            console.warn('Session update failed but attendance was updated');
        }

        const totalTime = Date.now() - startTime;
        console.log('✅ Clock-out successful!');
        console.log(`⏱️ Total time: ${totalTime}ms`);

        res.json({
            success: true,
            message: '✅ Clocked out successfully',
            clock_out_ist: clockOutIST,
            total_hours: Math.round(totalHours * 100) / 100,
            total_minutes: Math.round(totalMinutes),
            total_hours_display: `${Math.floor(totalMinutes / 60)}h ${Math.round(totalMinutes % 60)}m`,
            status: status,
            response_time_ms: totalTime
        });

    } catch (error) {
        console.error('❌ Clock-out error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to clock out',
            error: error.message,
            error_type: 'SERVER_ERROR'
        });
    }
};

// Get today's attendance
exports.getTodayAttendance = async (req, res) => {
    try {
        const { employee_id } = req.params;
        if (!employee_id) return res.status(400).json({ success: false, message: 'Employee ID is required' });
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const { data: employees } = await supabase.from('employees').select('*').eq('employee_id', employee_id);
        if (!employees || employees.length === 0) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }
        const { data: todayAttendance } = await supabase
            .from('attendance')
            .select('*, employees!inner(first_name, last_name, shift_timing, comp_off_balance)')
            .eq('employee_id', employee_id)
            .eq('attendance_date', todayStr)
            .order('clock_in', { ascending: false })
            .limit(1);
        const { data: activeSession } = await supabase
            .from('attendance_sessions')
            .select('*')
            .eq('employee_id', employee_id)
            .eq('is_active', true);
        let formattedAttendance = null;
        if (todayAttendance && todayAttendance.length > 0) {
            formattedAttendance = { ...todayAttendance[0] };
            if (formattedAttendance.employees) {
                formattedAttendance.first_name = formattedAttendance.employees.first_name;
                formattedAttendance.last_name = formattedAttendance.employees.last_name;
                formattedAttendance.shift_timing = formattedAttendance.employees.shift_timing;
                delete formattedAttendance.employees;
            }
            if (formattedAttendance.late_minutes > 0) {
                formattedAttendance.late_display = formatLateTime(formattedAttendance.late_minutes);
            }

            if (formattedAttendance.clock_in_ist && !formattedAttendance.clock_out_ist) {
                const clockInTime = parseLocalDateTimeIST(formattedAttendance.clock_in_ist);
                const nowDate = new Date();
                const diffMinutes = (nowDate - clockInTime) / (1000 * 60);
                const hours = Math.floor(diffMinutes / 60);
                const minutes = Math.round(diffMinutes % 60);
                formattedAttendance.total_hours_display = `${hours}h ${minutes}m`;
            } else if (formattedAttendance.total_minutes) {
                const minutes = formattedAttendance.total_minutes;
                formattedAttendance.total_hours_display = `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
            }

            formattedAttendance.clock_in = formattedAttendance.clock_in_ist || formattedAttendance.clock_in;
            formattedAttendance.clock_out = formattedAttendance.clock_out_ist || formattedAttendance.clock_out;
            formattedAttendance.late_minutes = Number(formattedAttendance.late_minutes) || 0;
            formattedAttendance.late_display = formattedAttendance.late_display || (formattedAttendance.late_minutes > 0 ? formatLateTime(formattedAttendance.late_minutes) : null);
            formattedAttendance.is_late = formattedAttendance.late_minutes > 0;

            if (!formattedAttendance.status) {
                if (formattedAttendance.clock_in && !formattedAttendance.clock_out) {
                    formattedAttendance.status = 'working';
                } else if (formattedAttendance.clock_in && formattedAttendance.clock_out) {
                    formattedAttendance.status = 'present';
                }
            }
        }
        res.json({
            success: true,
            attendance: formattedAttendance,
            active_session: activeSession && activeSession.length > 0 ? activeSession[0] : null,
            has_active_session: activeSession && activeSession.length > 0,
            today_date: todayStr
        });
    } catch (error) {
        console.error('❌ Error in getTodayAttendance:', error);
        res.status(500).json({ success: false, message: 'Failed to get attendance', error: error.message });
    }
};

// Helper function to parse IST datetime string
const parseLocalDateTimeIST = (datetimeStr) => {
    if (!datetimeStr) return null;
    if (datetimeStr instanceof Date) return datetimeStr;

    if (typeof datetimeStr === 'string' && datetimeStr.includes(' ')) {
        const [datePart, timePart] = datetimeStr.split(' ');
        const [year, month, day] = datePart.split('-');
        const [hour, minute, second] = timePart.split(':');
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second || 0));
    }

    const parsed = new Date(datetimeStr);
    return isNaN(parsed.getTime()) ? null : parsed;
};

// Get attendance report
exports.getAttendanceReport = async (req, res) => {
    try {
        const { start, end, employee_id } = req.query;
        if (!start || !end) {
            return res.status(400).json({ success: false, message: 'Start and end dates are required' });
        }
        let query = supabase
            .from('attendance')
            .select('*, employees(first_name, last_name, department, shift_timing, comp_off_balance)')
            .gte('attendance_date', start)
            .lte('attendance_date', end);
        if (employee_id) query = query.eq('employee_id', employee_id);
        query = query.order('attendance_date', { ascending: false });
        const { data: attendance, error: attendanceError } = await query;
        if (attendanceError) throw attendanceError;

        const formattedAttendance = (attendance || []).map(record => {
            const employee = record.employees || {};
            let totalHoursDisplay = '0h 0m';
            if (record.total_minutes) {
                totalHoursDisplay = `${Math.floor(record.total_minutes / 60)}h ${Math.round(record.total_minutes % 60)}m`;
            } else if (record.total_hours) {
                const totalMinutes = record.total_hours * 60;
                totalHoursDisplay = `${Math.floor(totalMinutes / 60)}h ${Math.round(totalMinutes % 60)}m`;
            }
            let lateDisplay = null;
            if (record.late_minutes && record.late_minutes > 0) {
                lateDisplay = formatLateTime(parseFloat(record.late_minutes));
            }
            const isLate = record.late_minutes && parseFloat(record.late_minutes) > 0;
            let status = record.status;
            if (!status) {
                if (record.clock_in && !record.clock_out) status = 'working';
                else if (record.clock_in && record.clock_out) status = 'present';
            }

            return {
                id: record.id,
                employee_id: record.employee_id,
                attendance_date: record.attendance_date,
                clock_in: record.clock_in_ist || record.clock_in,
                clock_out: record.clock_out_ist || record.clock_out,
                total_hours: record.total_hours,
                total_minutes: record.total_minutes,
                total_hours_display: totalHoursDisplay,
                status: status,
                is_late: isLate,
                late_minutes: record.late_minutes ? parseFloat(record.late_minutes) : 0,
                late_display: record.late_display || (isLate ? formatLateTime(parseFloat(record.late_minutes)) : null),
                early_minutes: record.early_minutes,
                shift_time_used: record.shift_time_used,
                is_holiday: record.is_holiday,
                holiday_name: record.holiday_name,
                comp_off_awarded: record.comp_off_awarded,
                comp_off_days: record.comp_off_days,
                is_regularized: record.is_regularized || false,
                first_name: employee.first_name || '',
                last_name: employee.last_name || '',
                department: employee.department || ''
            };
        });

        let totalWorkingMinutes = 0;
        formattedAttendance.forEach(a => {
            if (a.total_minutes) totalWorkingMinutes += a.total_minutes;
            else if (a.total_hours) totalWorkingMinutes += a.total_hours * 60;
        });

        res.json({
            success: true,
            attendance: formattedAttendance,
            stats: {
                total: formattedAttendance.length,
                present: formattedAttendance.filter(a => a.status === 'present').length,
                half_day: formattedAttendance.filter(a => a.status === 'half_day').length,
                absent: formattedAttendance.filter(a => a.status === 'absent').length,
                total_working_minutes: totalWorkingMinutes,
                total_working_hours: Math.round((totalWorkingMinutes / 60) * 100) / 100,
                total_working_hours_display: `${Math.floor(totalWorkingMinutes / 60)}h ${Math.round(totalWorkingMinutes % 60)}m`
            }
        });
    } catch (error) {
        console.error('❌ Error in getAttendanceReport:', error);
        res.status(500).json({ success: false, message: 'Failed to get attendance report', error: error.message });
    }
};

// Get missed clock-outs with hours calculation
exports.getMissedClockOuts = async (req, res) => {
    try {
        const { employee_id } = req.params;

        // Get employee's shift timing
        const { data: employee, error: empError } = await supabase
            .from('employees')
            .select('shift_timing')
            .eq('employee_id', employee_id)
            .single();

        if (empError) throw empError;

        const shiftTiming = parseShiftTiming(employee?.shift_timing);
        const expectedShiftHours = shiftTiming.totalHours || 9;

        // Get records where clock_out IS NULL (missed clock-outs)
        const { data: missedRecords, error } = await supabase
            .from('attendance')
            .select('*, employees!inner(first_name, last_name, shift_timing)')
            .eq('employee_id', employee_id)
            .not('clock_in', 'is', null)
            .is('clock_out', null)
            .order('attendance_date', { ascending: false });

        if (error) throw error;

        const formattedRecords = [];
        const now = new Date();

        for (const record of (missedRecords || [])) {
            // Parse clock-in time
            let clockInDate;
            const clockInValue = record.clock_in_ist || record.clock_in;

            if (clockInValue && typeof clockInValue === 'string' && clockInValue.includes(' ')) {
                const [datePart, timePart] = clockInValue.split(' ');
                const [year, month, day] = datePart.split('-');
                const [hour, minute, second] = timePart.split(':');
                clockInDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second || 0));
            } else {
                clockInDate = new Date(clockInValue);
            }

            const totalMinutes = (now - clockInDate) / (1000 * 60);
            const totalHours = totalMinutes / 60;

            const canRegularize = totalHours >= expectedShiftHours &&
                !record.is_regularized &&
                !record.regularization_requested;

            // Format clock-in time for display
            let clockInDisplay = record.clock_in_ist || record.clock_in;
            if (clockInDisplay && typeof clockInDisplay === 'string' && clockInDisplay.includes(' ')) {
                const timePart = clockInDisplay.split(' ')[1];
                const [hour, minute] = timePart.split(':');
                const hourNum = parseInt(hour);
                const ampm = hourNum >= 12 ? 'PM' : 'AM';
                const hour12 = hourNum % 12 || 12;
                clockInDisplay = `${hour12}:${minute} ${ampm}`;
            }

            formattedRecords.push({
                id: record.id,
                attendance_date: record.attendance_date,
                clock_in: record.clock_in_ist || record.clock_in,
                clock_in_display: clockInDisplay,
                shift_timing: record.employees?.shift_timing,
                employee_name: `${record.employees?.first_name} ${record.employees?.last_name}`,
                is_regularized: record.is_regularized || false,
                regularization_requested: record.regularization_requested || false,
                regularization_status: record.regularization_status || 'pending',
                total_hours_worked: totalHours.toFixed(2),
                expected_hours: expectedShiftHours,
                can_regularize: canRegularize,
                hours_needed: canRegularize ? 0 : (expectedShiftHours - totalHours).toFixed(2),
                has_clock_out: false
            });
        }

        res.json({
            success: true,
            missed_clockouts: formattedRecords
        });

    } catch (error) {
        console.error('Error fetching missed clock-outs:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch missed clock-outs',
            error: error.message
        });
    }
};

// Request regularization
exports.requestRegularization = async (req, res) => {
    try {
        const { attendance_id, requested_clock_out_time, reason, attendance_date } = req.body;
        const { employee_id } = req.params;

        console.log('='.repeat(70));
        console.log('📝 REGULARIZATION REQUEST RECEIVED');
        console.log('Time:', new Date().toISOString());
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        console.log('='.repeat(70));

        if (!attendance_id || !requested_clock_out_time) {
            return res.status(400).json({
                success: false,
                message: 'Attendance ID and clock-out time are required'
            });
        }

        const { data: attendance, error: fetchError } = await supabase
            .from('attendance')
            .select('*')
            .eq('employee_id', employee_id)
            .eq('id', attendance_id)
            .maybeSingle();

        if (fetchError || !attendance) {
            console.error('❌ Error fetching attendance:', fetchError);
            return res.status(404).json({
                success: false,
                message: 'Attendance record not found'
            });
        }

        console.log('✅ Found attendance record:', {
            id: attendance.id,
            attendance_date: attendance.attendance_date,
            clock_in: attendance.clock_in_ist || attendance.clock_in
        });

        if (attendance.clock_out) {
            return res.status(400).json({
                success: false,
                message: 'This attendance record already has a clock-out time'
            });
        }

        if (attendance.regularization_requested) {
            return res.status(400).json({
                success: false,
                message: 'Regularization already requested for this record'
            });
        }

        // Store the requested time in IST format
        let requestedTimeIST = requested_clock_out_time;
        if (requested_clock_out_time.includes('T')) {
            requestedTimeIST = requested_clock_out_time.replace('T', ' ');
        }
        if (!requestedTimeIST.match(/\d{2}:\d{2}:\d{2}$/)) {
            requestedTimeIST = requestedTimeIST + ':00';
        }

        console.log('📝 Storing requested time (IST):', requestedTimeIST);

        const regularizationData = {
            employee_id: employee_id,
            attendance_id: String(attendance_id),
            attendance_date: attendance_date || attendance.attendance_date,
            clock_in_time: attendance.clock_in_ist || attendance.clock_in,
            requested_clock_out_time: requestedTimeIST,
            reason: reason || 'Missed clock-out',
            status: 'pending',
            created_at: new Date().toISOString()
        };

        const { data: request, error: reqError } = await supabase
            .from('regularization_requests')
            .insert([regularizationData])
            .select()
            .single();

        if (reqError) {
            console.error('❌ Error creating regularization request:', reqError);
            return res.status(500).json({
                success: false,
                message: 'Failed to create regularization request',
                error: reqError.message
            });
        }

        console.log('✅ Regularization request created successfully:', request.id);

        await supabase
            .from('attendance')
            .update({
                regularization_requested: true,
                regularization_request_id: request.id,
                regularization_status: 'pending'
            })
            .eq('id', attendance.id);

        res.json({
            success: true,
            message: 'Regularization request submitted successfully! HR will review your request.',
            request: {
                id: request.id,
                attendance_date: request.attendance_date,
                requested_clock_out_time: request.requested_clock_out_time,
                status: request.status
            }
        });

    } catch (error) {
        console.error('❌ Error requesting regularization:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit regularization request',
            error: error.message
        });
    }
};

exports.approveRegularization = async (req, res) => {
    try {
        const { request_id } = req.params;
        const { approved_clock_out_time, admin_notes } = req.body;

        console.log('='.repeat(70));
        console.log('🔄 APPROVING REGULARIZATION REQUEST');
        console.log('Request ID (from params):', request_id);
        console.log('Request ID type:', typeof request_id);
        console.log('='.repeat(70));

        if (!request_id) {
            return res.status(400).json({ success: false, message: 'Request ID is required' });
        }

        if (!approved_clock_out_time) {
            return res.status(400).json({ success: false, message: 'Clock-out time is required' });
        }

        // ✅ WORKAROUND: Try to fetch by UUID first, if that fails, try by numeric ID
        let request = null;
        let reqError = null;
        
        // Try as UUID first
        try {
            const result = await supabase
                .from('regularization_requests')
                .select('*')
                .eq('id', request_id)
                .maybeSingle();
            
            if (result.data) {
                request = result.data;
            } else {
                // Try as integer (convert to number)
                const numericId = parseInt(request_id);
                if (!isNaN(numericId)) {
                    const intResult = await supabase
                        .from('regularization_requests')
                        .select('*')
                        .eq('id', numericId)
                        .maybeSingle();
                    
                    if (intResult.data) {
                        request = intResult.data;
                        console.log('✅ Found request using numeric ID:', numericId);
                    }
                }
            }
            reqError = result.error;
        } catch (err) {
            reqError = err;
        }

        if (!request) {
            console.error('❌ Request not found for ID:', request_id);
            return res.status(404).json({
                success: false,
                message: 'Regularization request not found'
            });
        }

        console.log('✅ Request found:', {
            id: request.id,
            id_type: typeof request.id,
            status: request.status,
            employee_id: request.employee_id,
            attendance_id: request.attendance_id
        });

        // Rest of your code remains the same...
        // ... (keep all the rest of your approveRegularization code)
        
        // ✅ When updating, use the actual id from the request object
        const requestIdToUpdate = request.id; // This is the actual ID from the database
        
        console.log('Updating regularization request with ID:', requestIdToUpdate);
        console.log('ID type for update:', typeof requestIdToUpdate);
        
        const { error: requestUpdateError } = await supabase
            .from('regularization_requests')
            .update({
                status: 'approved',
                approved_clock_out_time: clockOutIST,
                approved_by: req.user?.id || null,
                approved_at: new Date().toISOString(),
                admin_notes: admin_notes || null
            })
            .eq('id', requestIdToUpdate);  // ✅ Use the ID from the request object

        if (requestUpdateError) {
            console.error('❌ Error updating request status:', requestUpdateError);
            return res.status(500).json({
                success: false,
                message: 'Failed to update request status',
                error: requestUpdateError.message
            });
        }

        // ... rest of your code
    } catch (error) {
        console.error('❌ Error in approveRegularization:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to approve regularization',
            error: error.message
        });
    }
};

// ✅ FIXED rejectRegularization
exports.rejectRegularization = async (req, res) => {
    try {
        const { request_id } = req.params;
        const { rejection_reason } = req.body;

        if (!request_id) {
            return res.status(400).json({ success: false, message: 'Request ID is required' });
        }

        // Fetch request (UUID)
        const { data: request, error: reqError } = await supabase
            .from('regularization_requests')
            .select('*')
            .eq('id', request_id)
            .single();

        if (reqError || !request) {
            console.error('Request not found:', request_id, reqError?.message);
            return res.status(404).json({
                success: false,
                message: 'Regularization request not found'
            });
        }

        // Update attendance
        const { error: attError } = await supabase
            .from('attendance')
            .update({
                regularization_status: 'rejected',
                regularization_rejection_reason: rejection_reason || 'No reason provided'
            })
            .eq('id', request.attendance_id);

        if (attError) throw attError;

        // Update regularization request
        const { error: requestError } = await supabase
            .from('regularization_requests')
            .update({
                status: 'rejected',
                rejection_reason: rejection_reason || 'No reason provided',
                rejected_at: new Date().toISOString(),
                rejected_by: req.user?.id
            })
            .eq('id', request_id);

        if (requestError) throw requestError;

        res.json({
            success: true,
            message: 'Regularization request rejected successfully'
        });
    } catch (error) {
        console.error('Error rejecting regularization:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reject regularization',
            error: error.message
        });
    }
};

exports.getPendingRegularizations = async (req, res) => {
    try {
        const { data: requests, error } = await supabase
            .from('regularization_requests')
            .select(`
                id,
                employee_id,
                attendance_id,
                attendance_date,
                clock_in_time,
                requested_clock_out_time,
                reason,
                status,
                created_at,
                approved_clock_out_time,
                admin_notes,
                rejection_reason
            `)
            .eq('status', 'pending')
            .order('created_at', { ascending: false });

        if (error) throw error;

        const formattedRequests = [];

        for (const req of (requests || [])) {
            const { data: employee } = await supabase
                .from('employees')
                .select('first_name, last_name, department')
                .eq('employee_id', req.employee_id)
                .maybeSingle();

            // CRITICAL: Convert UUID to string explicitly
            const requestId = req.id.toString(); // Ensure it's a string

            console.log('📋 Processing request:', {
                original_id: req.id,
                original_id_type: typeof req.id,
                converted_id: requestId,
                converted_id_type: typeof requestId
            });

            formattedRequests.push({
                id: requestId,  // Use the converted string
                employee_id: req.employee_id,
                employee_name: employee ? `${employee.first_name || ''} ${employee.last_name || ''}`.trim() : 'Unknown',
                department: employee?.department || 'N/A',
                attendance_date: req.attendance_date,
                attendance_id: req.attendance_id,
                clock_in_time: req.clock_in_time,
                requested_clock_out_time: req.requested_clock_out_time,
                reason: req.reason,
                status: req.status,
                created_at: req.created_at,
                approved_clock_out_time: req.approved_clock_out_time,
                admin_notes: req.admin_notes
            });
        }

        res.json({
            success: true,
            requests: formattedRequests
        });
    } catch (error) {
        console.error('❌ Error in getPendingRegularizations:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch requests',
            error: error.message
        });
    }
};

// Heartbeat
exports.heartbeat = async (req, res) => {
    try {
        const { employee_id, session_id, latitude, longitude } = req.body;
        await supabase
            .from('attendance_sessions')
            .update({ last_heartbeat: new Date().toISOString(), latitude, longitude })
            .eq('employee_id', employee_id)
            .eq('session_id', session_id)
            .eq('is_active', true);
        res.json({ success: true, timestamp: new Date() });
    } catch (error) {
        console.error('Heartbeat error:', error);
        res.status(500).json({ success: false, message: 'Heartbeat failed' });
    }
};

// Get employee attendance report
exports.getEmployeeAttendanceReport = async (req, res) => {
    try {
        const { start, end } = req.query;
        const { employee_id } = req.params;
        if (req.user?.employeeId !== employee_id && req.user?.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        if (!start || !end) {
            return res.status(400).json({ success: false, message: 'Start and end dates are required' });
        }
        const { data: attendance } = await supabase
            .from('attendance')
            .select('*, employees!inner(first_name, last_name, department, shift_timing, comp_off_balance)')
            .eq('employee_id', employee_id)
            .gte('attendance_date', start)
            .lte('attendance_date', end)
            .order('attendance_date', { ascending: false });

        const formattedAttendance = (attendance || []).map(record => {
            const employee = record.employees || {};
            let totalHoursDisplay = '0h 0m';
            if (record.total_minutes) {
                totalHoursDisplay = `${Math.floor(record.total_minutes / 60)}h ${Math.round(record.total_minutes % 60)}m`;
            } else if (record.total_hours) {
                const totalMinutes = record.total_hours * 60;
                totalHoursDisplay = `${Math.floor(totalMinutes / 60)}h ${Math.round(totalMinutes % 60)}m`;
            }
            let lateDisplay = null;
            if (record.late_minutes && record.late_minutes > 0) {
                lateDisplay = formatLateTime(parseFloat(record.late_minutes));
            }
            const isLate = record.late_minutes && parseFloat(record.late_minutes) > 0;
            let status = record.status;
            if (!status) {
                if (record.clock_in && !record.clock_out) status = 'working';
                else if (record.clock_in && record.clock_out) status = 'present';
            }

            return {
                id: record.id,
                employee_id: record.employee_id,
                attendance_date: record.attendance_date,
                clock_in: record.clock_in_ist || record.clock_in,
                clock_out: record.clock_out_ist || record.clock_out,
                total_hours: record.total_hours,
                total_minutes: record.total_minutes,
                total_hours_display: totalHoursDisplay,
                status: status,
                is_late: isLate,
                late_minutes: record.late_minutes ? parseFloat(record.late_minutes) : 0,
                late_display: record.late_display || (isLate ? formatLateTime(parseFloat(record.late_minutes)) : null),
                early_minutes: record.early_minutes,
                is_holiday: record.is_holiday,
                comp_off_awarded: record.comp_off_awarded,
                is_regularized: record.is_regularized || false,
                first_name: employee.first_name || '',
                last_name: employee.last_name || '',
                department: employee.department || ''
            };
        });

        let totalWorkingMinutes = 0;
        formattedAttendance.forEach(a => {
            if (a.total_minutes) totalWorkingMinutes += a.total_minutes;
            else if (a.total_hours) totalWorkingMinutes += a.total_hours * 60;
        });

        res.json({
            success: true,
            attendance: formattedAttendance,
            stats: {
                total: formattedAttendance.length,
                present: formattedAttendance.filter(a => a.status === 'present').length,
                half_day: formattedAttendance.filter(a => a.status === 'half_day').length,
                absent: formattedAttendance.filter(a => a.status === 'absent').length,
                total_working_minutes: totalWorkingMinutes,
                total_working_hours: Math.round((totalWorkingMinutes / 60) * 100) / 100,
                total_working_hours_display: `${Math.floor(totalWorkingMinutes / 60)}h ${Math.round(totalWorkingMinutes % 60)}m`
            }
        });
    } catch (error) {
        console.error('❌ Error in getEmployeeAttendanceReport:', error);
        res.status(500).json({ success: false, message: 'Failed to get attendance report', error: error.message });
    }
};

// Get overtime summary
exports.getOvertimeSummary = async (req, res) => {
    try {
        const { employee_id, month, year } = req.params;

        if (req.user?.employeeId !== employee_id && req.user?.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Access denied. You can only view your own overtime data.' });
        }

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        const { data: overtime, error } = await supabase
            .from('overtime_earnings')
            .select('*')
            .eq('employee_id', employee_id)
            .gte('attendance_date', startDateStr)
            .lte('attendance_date', endDateStr)
            .order('attendance_date', { ascending: true });
        if (error) throw error;
        const totalMinutes = overtime?.reduce((sum, record) => sum + (record.overtime_minutes || 0), 0) || 0;
        const totalHours = overtime?.reduce((sum, record) => sum + (record.overtime_hours || 0), 0) || 0;
        const totalAmount = overtime?.reduce((sum, record) => sum + (record.overtime_amount || 0), 0) || 0;
        res.json({
            success: true, employee_id, month, year,
            overtime: overtime || [],
            summary: {
                total_days: overtime?.length || 0,
                total_minutes: totalMinutes,
                total_hours: totalHours,
                total_hours_display: `${Math.floor(totalMinutes / 60)}h ${Math.round(totalMinutes % 60)}m`,
                total_amount: totalAmount,
                average_per_day: overtime?.length > 0 ? (totalHours / overtime.length).toFixed(2) : 0
            }
        });
    } catch (error) {
        console.error('Error fetching overtime summary:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch overtime summary', error: error.message });
    }
};

// Get comp-off balance
exports.getCompOffBalance = async (req, res) => {
    try {
        const { employee_id } = req.params;
        const { data, error } = await supabase
            .from('employees')
            .select('comp_off_balance, total_comp_off_earned, total_comp_off_used')
            .eq('employee_id', employee_id)
            .single();
        if (error) throw error;
        res.json({
            success: true,
            comp_off_balance: data.comp_off_balance || 0,
            total_earned: data.total_comp_off_earned || 0,
            total_used: data.total_comp_off_used || 0
        });
    } catch (error) {
        console.error('Error fetching comp-off balance:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch comp-off balance', error: error.message });
    }
};

// Get comp-off history
exports.getCompOffHistory = async (req, res) => {
    try {
        const { employee_id } = req.params;
        const { data, error } = await supabase
            .from('comp_off_earnings')
            .select('*')
            .eq('employee_id', employee_id)
            .order('attendance_date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, earnings: data || [] });
    } catch (error) {
        console.error('Error fetching comp-off history:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch comp-off history', error: error.message });
    }
};

// Mark absent at day end
exports.markAbsentAtDayEnd = async () => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const now = new Date();
        const { data: employees } = await supabase.from('employees').select('employee_id');
        let markedCount = 0, updatedCount = 0;
        for (const emp of employees || []) {
            const { data: attendance } = await supabase
                .from('attendance')
                .select('*')
                .eq('employee_id', emp.employee_id)
                .eq('attendance_date', today);
            if (!attendance || attendance.length === 0) {
                await supabase.from('attendance').insert([{ employee_id: emp.employee_id, attendance_date: today, status: 'absent' }]);
                markedCount++;
            } else if (attendance[0].clock_in && !attendance[0].clock_out) {
                let clockInDate;
                if (attendance[0].clock_in_ist) {
                    const [datePart, timePart] = attendance[0].clock_in_ist.split(' ');
                    const [year, month, day] = datePart.split('-');
                    const [hour, minute, second] = timePart.split(':');
                    clockInDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second || 0));
                } else {
                    clockInDate = new Date(attendance[0].clock_in);
                }
                const totalMinutes = calculateTimeDifferenceInMinutes(clockInDate, now);
                const totalHours = totalMinutes / 60;
                await supabase
                    .from('attendance')
                    .update({ status: 'half_day', total_hours: totalHours, total_minutes: totalMinutes })
                    .eq('id', attendance[0].id);
                updatedCount++;
            }
        }
        return { success: true, message: `Marked ${markedCount} absent, ${updatedCount} half_day` };
    } catch (error) {
        console.error('Error marking absent:', error);
        return { success: false, error: error.message };
    }
};

module.exports = exports;