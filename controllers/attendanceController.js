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

const normalizeName = (value) => {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
};

const getEmployeeById = async (employeeId) => {
    if (!employeeId) return null;

    let query = supabase
        .from('employees')
        .select('id, employee_id, first_name, last_name, reporting_manager, designation');

    if (!isNaN(employeeId)) {
        const { data, error } = await query.eq('id', parseInt(employeeId)).maybeSingle();
        if (!error && data) return data;
    }

    const { data, error } = await query.eq('employee_id', String(employeeId)).maybeSingle();

    if (error) {
        console.error(`❌ Error fetching employee ${employeeId}:`, error);
        return null;
    }

    return data;
};

const getTeamEmployeeIdsByManagerName = async (managerName) => {
    if (!managerName) return [];
    const { data, error } = await supabase
        .from('employees')
        .select('employee_id, reporting_manager');
    if (error || !data) {
        console.error('❌ Error fetching team members for manager:', error);
        return [];
    }
    const normalizedManager = normalizeName(managerName);
    return (data || [])
        .filter(emp => normalizeName(emp.reporting_manager) === normalizedManager)
        .map(emp => emp.employee_id);
};

const employeeHasDirectReports = async (employeeName) => {
    if (!employeeName) return false;
    const { data, error } = await supabase
        .from('employees')
        .select('employee_id, reporting_manager');
    if (error || !data) {
        console.error('❌ Error checking direct reports for:', employeeName, error);
        return false;
    }
    const normalizedManager = normalizeName(employeeName);
    return (data || []).some(emp => normalizeName(emp.reporting_manager) === normalizedManager);
};

const canUserActOnRegularization = async (userEmployeeId, userRole, requestEmployeeId) => {
    if (!userEmployeeId || !requestEmployeeId) return false;

    const requestEmployee = await getEmployeeById(requestEmployeeId);
    if (!requestEmployee) return false;

    const approver = await getEmployeeById(userEmployeeId);
    if (!approver) return false;

    const approverName = `${approver.first_name || ''} ${approver.last_name || ''}`.trim().toLowerCase();
    const requestEmployeeName = `${requestEmployee.first_name || ''} ${requestEmployee.last_name || ''}`.trim().toLowerCase();

    if (approverName === requestEmployeeName) {
        return false;
    }

    const requestEmployeeDesignation = requestEmployee.designation || '';
    const isRequestEmployeeManager = isTeamLeaderDesignation(requestEmployeeDesignation);

    if (userRole === 'admin') {
        if (isRequestEmployeeManager) {
            return true;
        }
        return false;
    }

    const requestEmployeeReportingManager = (requestEmployee.reporting_manager || '').trim().toLowerCase();
    const isReportingManager = requestEmployeeReportingManager && approverName === requestEmployeeReportingManager;

    if (isReportingManager) {
        return true;
    }

    return false;
};

const isTeamLeaderDesignation = (designation) => {
    if (!designation) return false;
    const d = designation.toLowerCase();
    return d.includes('team leader') || d.includes('team manager') ||
        d.includes('tl') || d.includes('lead') || d.includes('manager') ||
        d.includes('head') || d.includes('supervisor');
};

const canUserViewRegularization = async (userEmployeeId, userRole, requestEmployeeId) => {
    if (!userEmployeeId || !requestEmployeeId) return false;

    if (userEmployeeId === requestEmployeeId) return true;
    if (userRole === 'admin') return true;

    const requestEmployee = await getEmployeeById(requestEmployeeId);
    if (!requestEmployee) return false;

    const approver = await getEmployeeById(userEmployeeId);
    if (!approver) return false;

    const approverName = `${approver.first_name || ''} ${approver.last_name || ''}`.trim().toLowerCase();
    const requestEmployeeReportingManager = (requestEmployee.reporting_manager || '').trim().toLowerCase();

    return requestEmployeeReportingManager === approverName;
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const nowIST = () => {
    const now = new Date();
    const utcMs = now.getTime();
    const istMs = utcMs + IST_OFFSET_MS;
    const ist = new Date(istMs);
    const y = ist.getUTCFullYear();
    const mo = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const d = String(ist.getUTCDate()).padStart(2, '0');
    const h = String(ist.getUTCHours()).padStart(2, '0');
    const mi = String(ist.getUTCMinutes()).padStart(2, '0');
    const s = String(ist.getUTCSeconds()).padStart(2, '0');
    return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
};

const toUTCMs = (val) => {
    if (!val) return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val.getTime();
    const s = String(val).trim();
    if (/[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d.getTime();
    }
    const clean = s.replace('T', ' ').substring(0, 19);
    const [datePart, timePart] = clean.split(' ');
    if (!datePart || !timePart) return null;
    const [y, mo, d] = datePart.split('-').map(Number);
    const [h, mi, sec = 0] = timePart.split(':').map(Number);
    if ([y, mo, d, h, mi].some(isNaN)) return null;
    return Date.UTC(y, mo - 1, d, h, mi, sec) - IST_OFFSET_MS;
};

const utcMsToISTString = (ms) => {
    if (ms == null || isNaN(ms)) return null;
    const ist = new Date(ms + IST_OFFSET_MS);
    const y = ist.getUTCFullYear();
    const mo = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const d = String(ist.getUTCDate()).padStart(2, '0');
    const h = String(ist.getUTCHours()).padStart(2, '0');
    const mi = String(ist.getUTCMinutes()).padStart(2, '0');
    const s = String(ist.getUTCSeconds()).padStart(2, '0');
    return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
};

const istStringToUTCISO = (istStr) => {
    const ms = toUTCMs(istStr);
    return ms != null ? new Date(ms).toISOString() : null;
};

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

// ✅ CORRECTED recalculateLate function - uses stored shift_time_used first
const recalculateLate = (clockInIst, clockIn, storedShiftTiming, currentShiftTiming, attendanceDate) => {
    const clockInMs = toUTCMs(clockInIst || clockIn);
    if (clockInMs == null) return { late_minutes: 0, late_display: null, is_late: false };

    let shiftHour = 9, shiftMinute = 0;
    let shiftStringToUse = storedShiftTiming;

    if (!shiftStringToUse) {
        shiftStringToUse = currentShiftTiming;
    }

    if (shiftStringToUse) {
        let s = shiftStringToUse.trim();
        if (s.includes('-')) s = s.split('-')[0].trim();
        const m = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (m) {
            let h = parseInt(m[1]);
            const ampm = m[3].toUpperCase();
            if (ampm === 'PM' && h !== 12) h += 12;
            if (ampm === 'AM' && h === 12) h = 0;
            shiftHour = h; shiftMinute = parseInt(m[2]);
        } else {
            const m2 = s.match(/(\d{1,2}):(\d{2})/);
            if (m2) { shiftHour = parseInt(m2[1]); shiftMinute = parseInt(m2[2]); }
        }
    }

    const [ay, am, ad] = String(attendanceDate).substring(0, 10).split('-').map(Number);
    const shiftStartIST = `${ay}-${String(am).padStart(2, '0')}-${String(ad).padStart(2, '0')} ${String(shiftHour).padStart(2, '0')}:${String(shiftMinute).padStart(2, '0')}:00`;
    const shiftStartMs = toUTCMs(shiftStartIST);

    const diffMs = clockInMs - shiftStartMs;
    if (diffMs <= 0) return { late_minutes: 0, late_display: null, is_late: false };

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

    return {
        late_minutes: parseFloat(lateMinutes.toFixed(4)),
        late_display: parts.join(' '),
        is_late: true
    };
};

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
                const expectedWorkMinutes = (shiftTiming.totalHours || 9) * 60;
                let status = 'half_day';
                if (totalMinutes >= expectedWorkMinutes) status = 'present';
                else if (totalMinutes < 300) status = 'absent';

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

exports.clockIn = async (req, res) => {
    try {
        const { employee_id, latitude, longitude, accuracy } = req.body;

        const userAgent = req.headers['user-agent'] || '';
        const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|windows phone|iemobile|opera mini|mobile/i.test(userAgent.toLowerCase());
        const isTabletUA = /ipad|android(?!.*mobile)|tablet/i.test(userAgent.toLowerCase());

        if (isMobileUA || isTabletUA) {
            console.log('❌ Mobile/Tablet device blocked from clock-in:', {
                employee_id,
                userAgent,
                deviceType: isTabletUA ? 'Tablet' : 'Mobile'
            });
            return res.status(403).json({
                success: false,
                message: 'Attendance marking is not allowed from mobile or tablet devices. Please use a desktop or laptop computer with Chrome, Firefox, or Edge browser.'
            });
        }

        const viewportWidth = req.headers['x-viewport-width'];
        if (viewportWidth && parseInt(viewportWidth) < 768) {
            console.log('❌ Small screen device blocked from clock-in:', { employee_id, viewportWidth });
            return res.status(403).json({
                success: false,
                message: 'Attendance marking is not allowed from mobile devices. Please use a desktop or laptop computer.'
            });
        }

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

        const todayIST = nowIST().split(' ')[0];
        const { data: incompleteRecords } = await supabase
            .from('attendance')
            .select('*')
            .eq('employee_id', employee_id)
            .not('clock_in', 'is', null)
            .is('clock_out', null)
            .lt('attendance_date', todayIST)
            .order('attendance_date', { ascending: false });

        if (incompleteRecords && incompleteRecords.length > 0) {
            const incompleteRecord = incompleteRecords[0];
            const incompleteDate = incompleteRecord.attendance_date;

            console.log(`⚠️ Found incomplete attendance for ${incompleteDate}. Please clock out first.`);

            return res.status(400).json({
                success: false,
                message: `You have an incomplete attendance record from ${incompleteDate}. Please clock out for that day first before clocking in for today.`,
                has_missed_clockout: true,
                attendance_id: incompleteRecord.id,
                attendance_date: incompleteDate,
                clock_in_time: incompleteRecord.clock_in_ist || incompleteRecord.clock_in
            });
        }

        const { data: activeSessions } = await supabase
            .from('attendance_sessions')
            .select('*')
            .eq('employee_id', employee_id)
            .eq('is_active', true);

        if (activeSessions && activeSessions.length > 0) {
            const activeSession = activeSessions[0];
            const sessionISTDate = utcMsToISTString(new Date(activeSession.clock_in_time).getTime()).split(' ')[0];
            const todayISTDate = nowIST().split(' ')[0];

            if (sessionISTDate !== todayISTDate) {
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
        const sessionId = generateSessionId();
        const holidayCheck = isHoliday(now);

        const clockInIST = nowIST();
        const istDateForAttendance = clockInIST.split(' ')[0];
        const today = istDateForAttendance;

        let shiftHour = 9, shiftMinute = 0;
        let shiftDisplay = emp.shift_timing || '9:00 AM - 6:00 PM';

        console.log(`🔍 Processing shift timing for ${employee_id}: "${emp.shift_timing}"`);

        if (emp.shift_timing) {
            let startTimeStr = emp.shift_timing.trim();

            if (startTimeStr.includes('-')) {
                startTimeStr = startTimeStr.split('-')[0].trim();
            }

            let parsed = false;

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

            if (!parsed) {
                const militaryMatch = startTimeStr.match(/(\d{1,2}):(\d{2})/);
                if (militaryMatch) {
                    shiftHour = parseInt(militaryMatch[1]);
                    shiftMinute = parseInt(militaryMatch[2]);
                    parsed = true;
                    console.log(`✅ Parsed 24-hour format: ${shiftHour}:${shiftMinute}`);
                }
            }

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
        }

        const shiftStartIST = `${istDateForAttendance} ${String(shiftHour).padStart(2, '0')}:${String(shiftMinute).padStart(2, '0')}:00`;
        const clockInMs = toUTCMs(clockInIST);
        const shiftStartMs = toUTCMs(shiftStartIST);
        const diffMs = clockInMs - shiftStartMs;
        const isLate = diffMs > 0;
        const isEarly = diffMs < 0;

        let lateMinutes = 0, earlyMinutes = 0, lateDisplay = null;
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
        } else if (isEarly) {
            earlyMinutes = Math.abs(diffMs) / (1000 * 60);
        }

        const lateMinutesToSave = isLate ? parseFloat(lateMinutes.toFixed(4)) : 0;
        const earlyMinutesToSave = isEarly ? parseFloat(earlyMinutes.toFixed(4)) : 0;

        const { data: existingAttendance } = await supabase
            .from('attendance')
            .select('*')
            .eq('employee_id', employee_id)
            .eq('attendance_date', istDateForAttendance)
            .limit(1);

        if (existingAttendance && existingAttendance.length > 0) {
            if (existingAttendance[0].clock_in && existingAttendance[0].clock_out) {
                return res.status(400).json({ success: false, message: 'You have already clocked in today' });
            }
            if (existingAttendance[0].clock_in && !existingAttendance[0].clock_out) {
                return res.status(400).json({
                    success: false,
                    message: 'You have an incomplete attendance record from today. Please clock out or request regularization.',
                    has_missed_clockout: true,
                    attendance_id: existingAttendance[0].id
                });
            }
        }

        const attendanceData = {
            employee_id,
            attendance_date: istDateForAttendance,
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
            holiday_name: holidayCheck.name || null,
            status: 'present'
        };

        if (lateDisplay) {
            attendanceData.late_display = lateDisplay;
        }

        let insertedAttendance, insertError;
        ({ data: insertedAttendance, error: insertError } = await supabase
            .from('attendance')
            .insert([attendanceData])
            .select());

        if (insertError && insertError.message && insertError.message.includes('late_display')) {
            console.log('⚠️ late_display column missing, retrying without it...');
            const { late_display: _removed, ...dataWithoutLateDisplay } = attendanceData;
            ({ data: insertedAttendance, error: insertError } = await supabase
                .from('attendance')
                .insert([dataWithoutLateDisplay])
                .select());
        }

        if (insertError) {
            console.error('❌ Insert error:', insertError);
            throw insertError;
        }

        await supabase.from('attendance_sessions').insert([{
            employee_id,
            session_id: sessionId,
            clock_in_time: now.toISOString(),
            last_heartbeat: now.toISOString(),
            is_active: true,
            latitude: latitude || null,
            longitude: longitude || null,
            location_accuracy: accuracy || null,
            device_info: {
                user_agent: userAgent,
                is_mobile: isMobileUA,
                timestamp: new Date().toISOString()
            }
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
            is_holiday: holidayCheck.isHoliday,
            device_blocked: false
        };

        console.log(`✅ Clock-in successful for ${employee_id}:`, {
            is_late: isLate,
            late_display: lateDisplay,
            late_minutes: lateMinutesToSave,
            device: isMobileUA ? 'Mobile (Blocked would have been blocked)' : 'Desktop (Allowed)'
        });

        res.json(response);

    } catch (error) {
        console.error('❌ Clock-in error:', error);
        res.status(500).json({ success: false, message: 'Failed to clock in', error: error.message });
    }
};

exports.clockOut = async (req, res) => {
    try {
        console.log('📍 CLOCK-OUT REQUEST START');
        const { employee_id, session_id } = req.body;

        const userAgent = req.headers['user-agent'] || '';
        const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|windows phone|iemobile|opera mini|mobile/i.test(userAgent.toLowerCase());
        const isTabletUA = /ipad|android(?!.*mobile)|tablet/i.test(userAgent.toLowerCase());

        if (isMobileUA || isTabletUA) {
            console.log('❌ Mobile/Tablet device blocked from clock-out:', { employee_id, userAgent });
            return res.status(403).json({
                success: false,
                message: 'Attendance marking is not allowed from mobile or tablet devices. Please use a desktop or laptop computer.'
            });
        }

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

        const clockInIST = attendanceRecord.clock_in_ist || nowIST();
        const clockOutIST = nowIST();

        const clockInMs = toUTCMs(clockInIST);
        const clockOutMs = toUTCMs(clockOutIST);
        let totalMinutes = Math.round((clockOutMs - clockInMs) / (1000 * 60));
        if (totalMinutes < 0) totalMinutes += 24 * 60;
        const totalHours = totalMinutes / 60;

        const shiftTiming = parseShiftTiming(employee?.shift_timing);
        const expectedWorkHours = shiftTiming.totalHours || 9;
        const expectedWorkMinutes = expectedWorkHours * 60;

        let status = 'half_day';
        if (totalMinutes >= expectedWorkMinutes) {
            status = 'present';
        } else if (totalMinutes < 300) {
            status = 'absent';
        }

        const overtime = calculateOvertime(totalHours, shiftTiming.totalHours);

        const displayHours = Math.floor(totalMinutes / 60);
        const displayMinutes = totalMinutes % 60;
        const totalHoursDisplay = `${displayHours}h ${displayMinutes}m`;

        const updateData = {
            clock_out: istStringToUTCISO(clockOutIST),
            clock_out_ist: clockOutIST,
            total_hours: parseFloat(totalHours.toFixed(2)),
            total_minutes: totalMinutes,
            total_hours_display: totalHoursDisplay,
            status: status,
            overtime_hours: overtime.overtimeHours,
            overtime_minutes: overtime.overtimeMinutes,
            overtime_amount: overtime.overtimeAmount,
            has_overtime: overtime.hasOvertime
        };

        console.log(`⏱️ Total minutes: ${totalMinutes}, Expected: ${expectedWorkMinutes}, Status: ${status}`);
        console.log('⏱️ Updating attendance record...');

        const { error: updateError } = await supabase
            .from('attendance')
            .update(updateData)
            .eq('id', attendanceRecord.id);

        if (updateError) {
            console.error('❌ Error updating attendance:', updateError);
            throw updateError;
        }

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
            total_hours: parseFloat(totalHours.toFixed(2)),
            total_minutes: totalMinutes,
            total_hours_display: totalHoursDisplay,
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

exports.clockOutMissed = async (req, res) => {
    try {
        const { employee_id, attendance_id, attendance_date } = req.body;

        if (!employee_id || !attendance_id) {
            return res.status(400).json({ success: false, message: 'Employee ID and Attendance ID are required' });
        }

        const { data: attendance, error: fetchError } = await supabase
            .from('attendance')
            .select('*')
            .eq('id', attendance_id)
            .eq('employee_id', employee_id)
            .maybeSingle();

        if (fetchError || !attendance) {
            return res.status(404).json({ success: false, message: 'Attendance record not found' });
        }

        if (attendance.clock_out) {
            return res.status(400).json({ success: false, message: 'This attendance record already has a clock-out time' });
        }

        const currentIST = nowIST();
        const clockInTime = new Date(attendance.clock_in_ist || attendance.clock_in);
        const currentTime = new Date(currentIST);
        const clockOutIST = currentIST;

        let totalMinutes = Math.round((currentTime - clockInTime) / (1000 * 60));
        if (totalMinutes < 0) {
            totalMinutes += 24 * 60;
        }

        console.log(`⏰ Clock out for ${attendance.attendance_date}: ${clockOutIST}`);

        const totalHours = totalMinutes / 60;
        const totalHoursDisplay = `${Math.floor(totalMinutes / 60)}h ${Math.round(totalMinutes % 60)}m`;

        const shiftTiming = parseShiftTiming(attendance.shift_time_used);
        const expectedWorkMinutes = (shiftTiming.totalHours || 9) * 60;

        let status = 'half_day';
        if (totalMinutes >= expectedWorkMinutes) {
            status = 'present';
        } else if (totalMinutes < 300) {
            status = 'absent';
        }

        const { error: updateError } = await supabase
            .from('attendance')
            .update({
                clock_out: istStringToUTCISO(clockOutIST),
                clock_out_ist: clockOutIST,
                total_hours: parseFloat(totalHours.toFixed(2)),
                total_minutes: totalMinutes,
                total_hours_display: totalHoursDisplay,
                status: status
            })
            .eq('id', attendance.id);

        if (updateError) {
            console.error('Error updating attendance:', updateError);
            throw updateError;
        }

        res.json({
            success: true,
            message: `Clocked out successfully for ${attendance.attendance_date} at ${clockOutIST.split(' ')[1]}`,
            data: {
                attendance_date: attendance.attendance_date,
                clock_out_ist: clockOutIST,
                total_hours: totalHours.toFixed(2),
                total_minutes: totalMinutes,
                total_hours_display: totalHoursDisplay,
                status: status
            }
        });

    } catch (error) {
        console.error('Error in clockOutMissed:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to clock out for missed day',
            error: error.message
        });
    }
};

exports.getTodayAttendance = async (req, res) => {
    try {
        const { employee_id } = req.params;
        if (!employee_id) return res.status(400).json({ success: false, message: 'Employee ID is required' });

        const todayStr = nowIST().split(' ')[0];

        const { data: employees } = await supabase.from('employees').select('*').eq('employee_id', employee_id);
        if (!employees || employees.length === 0) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }
        const employee = employees[0];

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

        let activeSessionAttendance = null;
        if (activeSession && activeSession.length > 0) {
            const session = activeSession[0];
            const { data: sessionAttendance } = await supabase
                .from('attendance')
                .select('*, employees!inner(first_name, last_name, shift_timing, comp_off_balance)')
                .eq('employee_id', employee_id)
                .eq('session_id', session.session_id)
                .order('clock_in', { ascending: false })
                .limit(1);

            if (sessionAttendance && sessionAttendance.length > 0) {
                activeSessionAttendance = sessionAttendance[0];
                if (activeSessionAttendance.employees) {
                    activeSessionAttendance.first_name = activeSessionAttendance.employees.first_name;
                    activeSessionAttendance.last_name = activeSessionAttendance.employees.last_name;
                    activeSessionAttendance.shift_timing = activeSessionAttendance.employees.shift_timing;
                    delete activeSessionAttendance.employees;
                }
            }
        }

        const attendanceToProcess = todayAttendance && todayAttendance.length > 0 ? todayAttendance[0] : activeSessionAttendance;

        if (attendanceToProcess) {
            formattedAttendance = { ...attendanceToProcess };
            if (formattedAttendance.employees) {
                formattedAttendance.first_name = formattedAttendance.employees.first_name;
                formattedAttendance.last_name = formattedAttendance.employees.last_name;
                formattedAttendance.shift_timing = formattedAttendance.employees.shift_timing;
                delete formattedAttendance.employees;
            }

            if (formattedAttendance.clock_in || formattedAttendance.clock_in_ist) {
                let clockInTime;
                const clockInValue = formattedAttendance.clock_in_ist || formattedAttendance.clock_in;

                if (clockInValue && typeof clockInValue === 'string' && clockInValue.includes(' ')) {
                    const [datePart, timePart] = clockInValue.split(' ');
                    const [year, month, day] = datePart.split('-');
                    const [hour, minute, second] = timePart.split(':');
                    clockInTime = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second || 0));
                } else {
                    clockInTime = new Date(clockInValue);
                }

                if (clockInTime && !isNaN(clockInTime.getTime())) {
                    let shiftHour = 9, shiftMinute = 0;
                    const shiftString = employee.shift_timing || formattedAttendance.shift_time_used;

                    if (shiftString) {
                        let startTimeStr = shiftString.trim();
                        if (startTimeStr.includes('-')) {
                            startTimeStr = startTimeStr.split('-')[0].trim();
                        }
                        let parsed = false;

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

                        if (!parsed) {
                            const militaryMatch = startTimeStr.match(/(\d{1,2}):(\d{2})/);
                            if (militaryMatch) {
                                shiftHour = parseInt(militaryMatch[1]);
                                shiftMinute = parseInt(militaryMatch[2]);
                                parsed = true;
                            }
                        }

                        if (!parsed) {
                            const hourMatch = startTimeStr.match(/^(\d{1,2})$/);
                            if (hourMatch) {
                                shiftHour = parseInt(hourMatch[1]);
                                shiftMinute = 0;
                                parsed = true;
                            }
                        }
                    }

                    const attendanceDate = new Date(formattedAttendance.attendance_date);
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
                    }

                    formattedAttendance.late_minutes = isLate ? parseFloat(lateMinutes.toFixed(4)) : 0;
                    formattedAttendance.late_display = lateDisplay;
                    formattedAttendance.is_late = isLate;

                    if (todayAttendance && todayAttendance.length > 0) {
                        const storedLateMinutes = parseFloat(todayAttendance[0].late_minutes) || 0;
                        const needsUpdate = Math.abs(storedLateMinutes - formattedAttendance.late_minutes) > 0.01 ||
                            todayAttendance[0].late_display !== formattedAttendance.late_display;

                        if (needsUpdate) {
                            console.log(`🔄 Updating attendance record ${todayAttendance[0].id} with correct late marks`);
                            const updatePayload = { late_minutes: formattedAttendance.late_minutes };
                            if (todayAttendance[0].hasOwnProperty('late_display')) {
                                updatePayload.late_display = formattedAttendance.late_display;
                            }
                            await supabase
                                .from('attendance')
                                .update(updatePayload)
                                .eq('id', todayAttendance[0].id);
                        }
                    }
                }
            }

            if (formattedAttendance.clock_in_ist && !formattedAttendance.clock_out_ist) {
                const clockInMs = toUTCMs(formattedAttendance.clock_in_ist);
                const nowMs = toUTCMs(nowIST());
                let diffMinutes = (nowMs - clockInMs) / (1000 * 60);
                if (diffMinutes < 0) diffMinutes += 24 * 60;
                const hours = Math.floor(diffMinutes / 60);
                const minutes = Math.round(diffMinutes % 60);
                formattedAttendance.total_hours_display = `${hours}h ${minutes}m`;
            } else if (formattedAttendance.total_minutes) {
                const minutes = formattedAttendance.total_minutes;
                formattedAttendance.total_hours_display = `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
            }

            formattedAttendance.clock_in = formattedAttendance.clock_in_ist || formattedAttendance.clock_in;
            formattedAttendance.clock_out = formattedAttendance.clock_out_ist || formattedAttendance.clock_out;

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

        const { data: approvedLeaves, error: leaveError } = await supabase
            .from('leaves')
            .select('employee_id, start_date, end_date, leave_type, status')
            .eq('status', 'approved')
            .lte('start_date', end)
            .gte('end_date', start);

        if (leaveError) console.error('Error fetching leaves:', leaveError);

        const leaveMap = {};
        if (approvedLeaves) {
            approvedLeaves.forEach(leave => {
                const leaveStart = new Date(leave.start_date);
                const leaveEnd = new Date(leave.end_date || leave.start_date);
                for (let d = new Date(leaveStart); d <= leaveEnd; d.setDate(d.getDate() + 1)) {
                    const dateStr = d.toISOString().split('T')[0];
                    const key = `${leave.employee_id}-${dateStr}`;
                    leaveMap[key] = { type: leave.leave_type, status: leave.status };
                }
            });
        }

        const dedupedAttendanceMap = {};
        (attendance || []).forEach(record => {
            const dateKey = record.attendance_date ? record.attendance_date.split('T')[0] : record.attendance_date;
            const key = `${record.employee_id}-${dateKey}`;
            const leaveInfo = leaveMap[key];
            const existing = dedupedAttendanceMap[key];

            if (!existing) {
                if (leaveInfo) {
                    record.status = 'on_leave';
                    record.leave_type = leaveInfo.type;
                    record.leave_status = leaveInfo.status;
                }
                dedupedAttendanceMap[key] = record;
                return;
            }

            const existingClockOut = existing.clock_out_ist || existing.clock_out;
            const newClockOut = record.clock_out_ist || record.clock_out;
            if (newClockOut && !existingClockOut) {
                if (leaveInfo) {
                    record.status = 'on_leave';
                    record.leave_type = leaveInfo.type;
                    record.leave_status = leaveInfo.status;
                }
                dedupedAttendanceMap[key] = record;
            } else if (newClockOut && existingClockOut) {
                const existingMs = toUTCMs(existingClockOut);
                const newMs = toUTCMs(newClockOut);
                if (newMs > existingMs) {
                    if (leaveInfo) {
                        record.status = 'on_leave';
                        record.leave_type = leaveInfo.type;
                        record.leave_status = leaveInfo.status;
                    }
                    dedupedAttendanceMap[key] = record;
                }
            } else if (!existingClockOut && !newClockOut) {
                if (leaveInfo && !existing.leave_type) {
                    existing.status = 'on_leave';
                    existing.leave_type = leaveInfo.type;
                    existing.leave_status = leaveInfo.status;
                }
                dedupedAttendanceMap[key] = existing;
            }
        });

        const formattedAttendance = (Object.values(dedupedAttendanceMap) || []).map(record => {
            const employee = record.employees || {};
            let totalHoursDisplay = '0h 0m';
            if (record.total_minutes) {
                totalHoursDisplay = `${Math.floor(record.total_minutes / 60)}h ${Math.round(record.total_minutes % 60)}m`;
            } else if (record.total_hours) {
                const totalMinutes = record.total_hours * 60;
                totalHoursDisplay = `${Math.floor(totalMinutes / 60)}h ${Math.round(totalMinutes % 60)}m`;
            }

            const late = recalculateLate(
                record.clock_in_ist,
                record.clock_in,
                record.shift_time_used,
                employee.shift_timing,
                record.attendance_date
            );

            let status = record.status;
            if (!status) {
                if (record.clock_in && !record.clock_out) status = 'working';
                else if (record.clock_in && record.clock_out) status = 'present';
                else status = 'absent';
            }

            if (record.leave_type) {
                status = 'on_leave';
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
                is_late: late.is_late,
                late_minutes: late.late_minutes,
                late_display: late.late_display,
                early_minutes: record.early_minutes,
                shift_time_used: employee.shift_timing || record.shift_time_used,
                is_holiday: record.is_holiday,
                holiday_name: record.holiday_name,
                comp_off_awarded: record.comp_off_awarded,
                comp_off_days: record.comp_off_days,
                is_regularized: record.is_regularized || false,
                first_name: employee.first_name || '',
                last_name: employee.last_name || '',
                department: employee.department || '',
                leave_type: record.leave_type || null,
                is_on_leave: !!record.leave_type
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
                on_leave: formattedAttendance.filter(a => a.status === 'on_leave').length,
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

exports.getMissedClockOuts = async (req, res) => {
    try {
        const { employee_id } = req.params;

        const { data: employee, error: empError } = await supabase
            .from('employees')
            .select('shift_timing')
            .eq('employee_id', employee_id)
            .single();

        if (empError) throw empError;

        const shiftTiming = parseShiftTiming(employee?.shift_timing);
        const expectedShiftHours = shiftTiming.totalHours || 9;

        const { data: missedRecords, error } = await supabase
            .from('attendance')
            .select('*, employees!inner(first_name, last_name, shift_timing)')
            .eq('employee_id', employee_id)
            .not('clock_in', 'is', null)
            .is('clock_out', null)
            .order('attendance_date', { ascending: false });

        if (error) throw error;

        const formattedRecords = [];
        const nowISTStr = nowIST();
        const nowMs = toUTCMs(nowISTStr);
        const todayISTDate = nowISTStr.split(' ')[0];

        for (const record of (missedRecords || [])) {
            const clockInValue = record.clock_in_ist || record.clock_in;
            const clockInMs = toUTCMs(clockInValue);
            let totalMinutes = clockInMs != null ? (nowMs - clockInMs) / (1000 * 60) : 0;
            if (totalMinutes < 0) totalMinutes += 24 * 60;
            const totalHours = totalMinutes / 60;

            const isToday = record.attendance_date === todayISTDate;
            const canRegularize = !isToday && !record.is_regularized && !record.regularization_requested;

            let clockInDisplay = clockInValue;
            if (clockInDisplay && typeof clockInDisplay === 'string' && clockInDisplay.includes(' ')) {
                const timePart = clockInDisplay.split(' ')[1];
                const [hour, minute] = timePart.split(':');
                const hourNum = parseInt(hour);
                const ampm = hourNum >= 12 ? 'PM' : 'AM';
                const hour12 = hourNum % 12 === 0 ? 12 : hourNum % 12;
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

        res.json({ success: true, missed_clockouts: formattedRecords });
    } catch (error) {
        console.error('Error fetching missed clock-outs:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch missed clock-outs', error: error.message });
    }
};

exports.requestRegularization = async (req, res) => {
    try {
        const { attendance_id, requested_clock_out_time, reason, attendance_date } = req.body;
        const { employee_id } = req.params;

        if (req.user?.employeeId !== employee_id && req.user?.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'You can only request regularization for your own attendance record.'
            });
        }

        console.log('='.repeat(70));
        console.log('📝 REGULARIZATION REQUEST RECEIVED');
        console.log('Time:', new Date().toISOString());
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        console.log('='.repeat(70));

        if (!attendance_id || !requested_clock_out_time) {
            return res.status(400).json({ success: false, message: 'Attendance ID and clock-out time are required' });
        }

        const { data: attendance, error: fetchError } = await supabase
            .from('attendance')
            .select('*')
            .eq('employee_id', employee_id)
            .eq('id', attendance_id)
            .maybeSingle();

        if (fetchError || !attendance) {
            console.error('❌ Error fetching attendance:', fetchError);
            return res.status(404).json({ success: false, message: 'Attendance record not found' });
        }

        console.log('✅ Found attendance record:', {
            id: attendance.id,
            attendance_date: attendance.attendance_date,
            clock_in: attendance.clock_in_ist || attendance.clock_in
        });

        if (attendance.clock_out || attendance.clock_out_ist) {
            return res.status(400).json({ success: false, message: 'This attendance record already has a clock-out time' });
        }

        if (attendance.regularization_requested) {
            return res.status(400).json({ success: false, message: 'Regularization already requested for this record' });
        }

        let requestedTimeIST = requested_clock_out_time;
        if (requested_clock_out_time.includes('T')) {
            requestedTimeIST = requested_clock_out_time.replace('T', ' ');
        }
        if (!requestedTimeIST.match(/\d{2}:\d{2}:\d{2}$/)) {
            requestedTimeIST = requestedTimeIST + ':00';
        }

        console.log('📝 Storing requested time (IST):', requestedTimeIST);

        const { data: employeeRecord, error: employeeError } = await supabase
            .from('employees')
            .select('id')
            .eq('employee_id', employee_id)
            .maybeSingle();

        if (employeeError || !employeeRecord) {
            console.error('❌ Error finding employee record:', employeeError);
            return res.status(404).json({ success: false, message: 'Employee record not found' });
        }

        const numericEmployeeId = employeeRecord.id;
        const numericAttendanceId = parseInt(attendance_id);
        if (isNaN(numericAttendanceId)) {
            return res.status(400).json({ success: false, message: 'Invalid attendance ID' });
        }

        console.log('🔄 Converted IDs:', {
            stringEmployeeId: employee_id,
            numericEmployeeId: numericEmployeeId,
            attendanceId: attendance_id,
            numericAttendanceId: numericAttendanceId
        });

        const regularizationData = {
            employee_id: employee_id,
            attendance_id: numericAttendanceId,
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
            return res.status(500).json({ success: false, message: 'Failed to create regularization request', error: reqError.message });
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
            message: 'Regularization request submitted successfully! Your reporting manager will review your request.',
            request: {
                id: request.id,
                attendance_date: request.attendance_date,
                requested_clock_out_time: request.requested_clock_out_time,
                status: request.status
            }
        });
    } catch (error) {
        console.error('❌ Error requesting regularization:', error);
        res.status(500).json({ success: false, message: 'Failed to submit regularization request', error: error.message });
    }
};

exports.approveRegularization = async (req, res) => {
    try {
        const { request_id } = req.params;
        const id = request_id;
        const { approved_clock_out_time, admin_notes } = req.body;
        const approver_id = req.user?.employeeId;
        const userRole = req.user?.role;

        console.log('📝 Approving regularization id:', id);
        console.log('👤 Approver:', { approver_id, role: userRole });

        if (!approved_clock_out_time) {
            return res.status(400).json({ success: false, message: 'Approved clock out time is required' });
        }

        const { data: request, error: fetchError } = await supabase
            .from('regularization_requests')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (fetchError || !request) {
            return res.status(404).json({ success: false, message: 'Regularization request not found' });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Request already ${request.status}` });
        }

        const { data: requestEmployee, error: requestEmployeeError } = await supabase
            .from('employees')
            .select('designation, reporting_manager')
            .eq('employee_id', request.employee_id)
            .maybeSingle();

        if (requestEmployeeError || !requestEmployee) {
            return res.status(404).json({ success: false, message: 'Employee details not found' });
        }

        const requestEmployeeDesignation = requestEmployee?.designation || '';
        const isRequestEmployeeManager = isTeamLeaderDesignation(requestEmployeeDesignation);

        let isAuthorized = false;

        if (userRole === 'admin') {
            isAuthorized = true;
            console.log('✅ Admin authorized to approve regularization request');
        } else {
            const approver = await getEmployeeById(approver_id);
            if (!approver) {
                return res.status(404).json({ success: false, message: 'Approver not found' });
            }

            const approverName = `${approver.first_name || ''} ${approver.last_name || ''}`.trim().toLowerCase();
            const requestEmployeeReportingManager = (requestEmployee?.reporting_manager || '').trim().toLowerCase();

            if (requestEmployeeReportingManager === approverName) {
                isAuthorized = true;
                console.log('✅ Reporting manager authorized to approve request');
            }
        }

        if (!isAuthorized) {
            return res.status(403).json({ success: false, message: '❌ You are not authorized to approve this regularization request.' });
        }

        let clockOutIST = approved_clock_out_time;
        if (clockOutIST.includes('T')) {
            clockOutIST = clockOutIST.replace('T', ' ');
        }
        if (!clockOutIST.match(/\d{2}:\d{2}:\d{2}$/)) {
            clockOutIST = clockOutIST + ':00';
        }

        console.log('⏰ Approved clock out time (IST):', clockOutIST);

        const clockInTime = request.clock_in_time;
        const clockInMs = toUTCMs(clockInTime);
        const clockOutMs = toUTCMs(clockOutIST);
        let totalMinutes = Math.round((clockOutMs - clockInMs) / (1000 * 60));
        if (totalMinutes < 0) totalMinutes += 24 * 60;
        const totalHours = totalMinutes / 60;
        const totalHoursDisplay = `${Math.floor(totalMinutes / 60)}h ${Math.round(totalMinutes % 60)}m`;

        const { data: attendanceData } = await supabase
            .from('attendance')
            .select('shift_time_used')
            .eq('id', request.attendance_id)
            .maybeSingle();

        const shiftTiming = parseShiftTiming(attendanceData?.shift_time_used);
        const expectedWorkMinutes = (shiftTiming.totalHours || 9) * 60;

        let status = 'half_day';
        if (totalMinutes >= expectedWorkMinutes) {
            status = 'present';
        } else if (totalMinutes < 300) {
            status = 'absent';
        }

        await supabase
            .from('attendance')
            .update({
                clock_out: istStringToUTCISO(clockOutIST),
                clock_out_ist: clockOutIST,
                total_hours: parseFloat(totalHours.toFixed(2)),
                total_minutes: totalMinutes,
                total_hours_display: totalHoursDisplay,
                status: status,
                is_regularized: true,
                regularization_status: 'approved'
            })
            .eq('id', request.attendance_id);

        let approverNumericId = null;
        if (approver_id && typeof approver_id === 'string' && approver_id.startsWith('HR')) {
            const { data: approverData } = await supabase
                .from('employees')
                .select('id')
                .eq('employee_id', approver_id)
                .maybeSingle();
            if (approverData) {
                approverNumericId = approverData.id;
            }
        }

        const updateData = {
            status: 'approved',
            approved_at: new Date().toISOString(),
            approved_clock_out_time: clockOutIST,
            admin_notes: admin_notes || null
        };

        if (approverNumericId) {
            updateData.approved_by = approverNumericId;
        } else {
            updateData.approved_by = approver_id;
        }

        await supabase
            .from('regularization_requests')
            .update(updateData)
            .eq('id', id);

        console.log('✅ Regularization approved successfully');

        res.json({
            success: true,
            message: 'Regularization request approved successfully',
            data: {
                attendance_date: request.attendance_date,
                clock_in_time: request.clock_in_time,
                approved_clock_out_time: clockOutIST,
                total_hours: totalHours.toFixed(2),
                total_minutes: totalMinutes,
                status: status
            }
        });
    } catch (error) {
        console.error('❌ Error approving regularization:', error);
        res.status(500).json({ success: false, message: 'Failed to approve regularization', error: error.message });
    }
};

exports.rejectRegularization = async (req, res) => {
    try {
        const { request_id } = req.params;
        const id = request_id;
        const { rejection_reason } = req.body;
        const approver_id = req.user?.employeeId;
        const userRole = req.user?.role;

        console.log('📝 Rejecting regularization:', { id, rejection_reason, approver_id, role: userRole });

        if (!rejection_reason) {
            return res.status(400).json({ success: false, message: 'Rejection reason is required' });
        }

        const { data: request, error: fetchError } = await supabase
            .from('regularization_requests')
            .select(`
                *,
                employee:employee_id (
                    id,
                    first_name,
                    last_name,
                    email,
                    designation,
                    reporting_manager
                )
            `)
            .eq('id', id)
            .maybeSingle();

        if (fetchError || !request) {
            return res.status(404).json({ success: false, message: 'Regularization request not found' });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Request already ${request.status}` });
        }

        const requestEmployee = request.employee;

        let isAuthorized = false;

        if (userRole === 'admin') {
            isAuthorized = true;
            console.log('✅ Admin authorized to reject regularization request');
        } else {
            const approver = await getEmployeeById(approver_id);
            if (!approver) {
                return res.status(404).json({ success: false, message: 'Approver not found' });
            }

            const approverName = `${approver.first_name || ''} ${approver.last_name || ''}`.trim().toLowerCase();
            const requestEmployeeReportingManager = (requestEmployee?.reporting_manager || '').trim().toLowerCase();

            if (requestEmployeeReportingManager === approverName) {
                isAuthorized = true;
                console.log('✅ Reporting manager authorized to reject request');
            }
        }

        if (!isAuthorized) {
            return res.status(403).json({ success: false, message: '❌ You are not authorized to reject this regularization request.' });
        }

        await supabase
            .from('regularization_requests')
            .update({
                status: 'rejected',
                reviewed_at: new Date().toISOString(),
                rejection_reason: rejection_reason,
                reviewed_by: approver_id
            })
            .eq('id', id);

        await supabase
            .from('attendance')
            .update({ regularization_status: 'rejected' })
            .eq('id', request.attendance_id);

        console.log('✅ Regularization rejected successfully');

        res.json({ success: true, message: 'Regularization request rejected successfully' });
    } catch (error) {
        console.error('❌ Error rejecting regularization:', error);
        res.status(500).json({ success: false, message: 'Failed to reject regularization', error: error.message });
    }
};

exports.getPendingRegularizations = async (req, res) => {
    try {
        const userRole = req.user?.role;
        const userEmployeeId = req.user?.employeeId;
        const isAdmin = userRole === 'admin';

        let query = supabase
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
            .order('created_at', { ascending: false });

        if (isAdmin) {
            console.log('👑 Admin viewing all regularization requests');
        } else {
            const approver = await getEmployeeById(userEmployeeId);
            const approverName = `${approver?.first_name || ''} ${approver?.last_name || ''}`.trim().toLowerCase();

            if (!approverName) {
                return res.json({ success: true, requests: [] });
            }

            const teamEmployeeIds = await getTeamEmployeeIdsByManagerName(approverName);
            const employeeIds = [userEmployeeId, ...teamEmployeeIds];
            console.log(`👥 Manager ${approverName} can see requests for:`, employeeIds);
            query = query.in('employee_id', employeeIds);
        }

        const { data: requests, error } = await query;
        if (error) throw error;

        const formattedRequests = [];

        for (const request of (requests || [])) {
            const { data: employee } = await supabase
                .from('employees')
                .select('first_name, last_name, department, designation, reporting_manager')
                .eq('employee_id', request.employee_id)
                .maybeSingle();

            let can_act = false;

            if (userRole === 'admin') {
                can_act = request.status === 'pending';
                console.log('👑 Admin can act on request:', can_act);
            } else {
                const requestEmployeeReportingManager = (employee?.reporting_manager || '').trim().toLowerCase();
                const approver = await getEmployeeById(userEmployeeId);
                const approverName = `${approver?.first_name || ''} ${approver?.last_name || ''}`.trim().toLowerCase();
                can_act = requestEmployeeReportingManager === approverName && request.status === 'pending';
            }

            formattedRequests.push({
                id: request.id?.toString?.() ?? String(request.id),
                employee_id: request.employee_id,
                employee_name: employee ? `${employee.first_name || ''} ${employee.last_name || ''}`.trim() : 'Unknown',
                department: employee?.department || 'N/A',
                designation: employee?.designation || 'N/A',
                reporting_manager: employee?.reporting_manager || 'N/A',
                attendance_date: request.attendance_date,
                attendance_id: request.attendance_id,
                clock_in_time: request.clock_in_time,
                requested_clock_out_time: request.requested_clock_out_time,
                reason: request.reason,
                status: request.status,
                created_at: request.created_at,
                approved_clock_out_time: request.approved_clock_out_time,
                admin_notes: request.admin_notes,
                rejection_reason: request.rejection_reason,
                can_act: can_act
            });
        }

        res.json({ success: true, requests: formattedRequests });
    } catch (error) {
        console.error('❌ Error in getPendingRegularizations:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch requests', error: error.message });
    }
};

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

        const { data: attendance, error } = await supabase
            .from('attendance')
            .select('*, employees!inner(first_name, last_name, department, shift_timing, comp_off_balance)')
            .eq('employee_id', employee_id)
            .gte('attendance_date', start)
            .lte('attendance_date', end)
            .order('attendance_date', { ascending: false });

        if (error) throw error;

        const { data: approvedLeaves, error: leaveError } = await supabase
            .from('leaves')
            .select('start_date, end_date, leave_type, status')
            .eq('employee_id', employee_id)
            .eq('status', 'approved')
            .lte('start_date', end)
            .gte('end_date', start);

        if (leaveError) console.error('Error fetching leaves:', leaveError);

        const leaveMap = {};
        if (approvedLeaves) {
            approvedLeaves.forEach(leave => {
                const leaveStart = new Date(leave.start_date);
                const leaveEnd = new Date(leave.end_date || leave.start_date);
                for (let d = new Date(leaveStart); d <= leaveEnd; d.setDate(d.getDate() + 1)) {
                    const dateStr = d.toISOString().split('T')[0];
                    leaveMap[dateStr] = { type: leave.leave_type, status: leave.status };
                }
            });
        }

        // ✅ CORRECTED: Removed duplicate 'late' declaration
        const formattedAttendance = (attendance || []).map(record => {
            const employee = record.employees || {};
            
            // ✅ SINGLE declaration of 'late' with correct 5 parameters
            const late = recalculateLate(
                record.clock_in_ist,
                record.clock_in,
                record.shift_time_used,
                employee.shift_timing,
                record.attendance_date
            );
            
            let totalHoursDisplay = '0h 0m';
            if (record.total_minutes) {
                totalHoursDisplay = `${Math.floor(record.total_minutes / 60)}h ${Math.round(record.total_minutes % 60)}m`;
            } else if (record.total_hours) {
                const totalMinutes = record.total_hours * 60;
                totalHoursDisplay = `${Math.floor(totalMinutes / 60)}h ${Math.round(totalMinutes % 60)}m`;
            }

            let status = record.status;
            if (!status) {
                if (record.clock_in && !record.clock_out) status = 'working';
                else if (record.clock_in && record.clock_out) status = 'present';
                else status = 'absent';
            }

            const leaveInfo = leaveMap[record.attendance_date];
            if (leaveInfo) status = 'on_leave';

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
                is_late: late.is_late,
                late_minutes: late.late_minutes,
                late_display: late.late_display,
                early_minutes: record.early_minutes,
                is_holiday: record.is_holiday,
                comp_off_awarded: record.comp_off_awarded,
                is_regularized: record.is_regularized || false,
                first_name: employee.first_name || '',
                last_name: employee.last_name || '',
                department: employee.department || '',
                leave_type: leaveInfo?.type || null,
                is_on_leave: !!leaveInfo
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
                on_leave: formattedAttendance.filter(a => a.status === 'on_leave').length,
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

exports.getCompOffHistory = async (req, res) => {
    try {
        const { employee_id } = req.params;
        const userRole = req.user?.role;
        const loggedInEmployeeId = req.user?.employeeId;

        if (userRole !== 'admin' && loggedInEmployeeId !== employee_id) {
            return res.status(403).json({ success: false, message: 'Access denied. You can only view your own comp-off history.' });
        }

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

exports.updateHistoricalLateMarks = async (req, res) => {
    try {
        console.log('🚀 Starting historical late marks update via API...');

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

        if (attendanceError) throw attendanceError;

        console.log(`📊 Found ${attendanceRecords.length} attendance records to process`);

        let updatedCount = 0, alreadyCorrectCount = 0, errorCount = 0;

        for (const record of attendanceRecords) {
            try {
                const lateCalculation = recalculateLate(
                    record.clock_in_ist,
                    record.clock_in,
                    record.shift_time_used,
                    record.employees?.shift_timing,
                    record.attendance_date
                );

                const currentLateMinutes = parseFloat(record.late_minutes) || 0;
                const needsUpdate = Math.abs(currentLateMinutes - lateCalculation.late_minutes) > 0.01 ||
                    record.late_display !== lateCalculation.late_display;

                if (needsUpdate) {
                    const updatePayload = { late_minutes: lateCalculation.late_minutes };
                    if (record.hasOwnProperty('late_display')) {
                        updatePayload.late_display = lateCalculation.late_display;
                    }
                    const { error: updateError } = await supabase
                        .from('attendance')
                        .update(updatePayload)
                        .eq('id', record.id);

                    if (updateError) {
                        errorCount++;
                    } else {
                        updatedCount++;
                        if (lateCalculation.is_late) {
                            console.log(`✅ Updated ${record.employee_id} (${record.attendance_date}): Late ${lateCalculation.late_display}`);
                        }
                    }
                } else {
                    alreadyCorrectCount++;
                }
            } catch (recordError) {
                errorCount++;
            }
        }

        res.json({
            success: true,
            message: 'Historical late marks update completed successfully',
            totalRecords: attendanceRecords.length,
            updatedCount,
            alreadyCorrectCount,
            errorCount
        });
    } catch (error) {
        console.error('❌ Error in updateHistoricalLateMarks:', error);
        res.status(500).json({ success: false, message: 'Failed to update historical late marks', error: error.message });
    }
};

exports.markAbsentEmployeesAsLeave = async (req, res) => {
    try {
        console.log('🔄 Manual trigger: markAbsentEmployeesAsLeave called');
        const { markAbsentEmployeesAsLeave } = require('../cron/absentEmployeeCheck');
        const result = await markAbsentEmployeesAsLeave();

        if (result.success) {
            res.json({
                success: true,
                message: result.message,
                data: {
                    date: result.date,
                    totalEmployees: result.totalEmployees,
                    absentCount: result.absentCount,
                    leaveCreatedCount: result.leaveCreatedCount,
                    skippedCount: result.skippedCount
                }
            });
        } else {
            res.status(500).json({ success: false, message: 'Failed to process absent employees', error: result.error });
        }
    } catch (error) {
        console.error('❌ Error in markAbsentEmployeesAsLeave API:', error);
        res.status(500).json({ success: false, message: 'Failed to process absent employees', error: error.message });
    }
};

exports.getTeamAttendanceReport = async (req, res) => {
    try {
        const { start, end, employee_id, view_type } = req.query;
        const managerEmployeeId = req.user?.employeeId;
        const userRole = req.user?.role;

        console.log('📊 Fetching team attendance report for manager:', managerEmployeeId);

        const manager = await getEmployeeById(managerEmployeeId);
        if (!manager) {
            return res.status(404).json({ success: false, message: 'Manager not found' });
        }

        const managerName = `${manager.first_name || ''} ${manager.last_name || ''}`.trim().toLowerCase();
        const teamEmployeeIds = await getTeamEmployeeIdsByManagerName(managerName);

        if (teamEmployeeIds.length === 0) {
            return res.json({
                success: true,
                team_members: [],
                attendance: [],
                daily_stats: {},
                employee_summary: [],
                summary: {
                    total_team_members: 0,
                    total_present_today: 0,
                    total_absent_today: 0,
                    total_on_leave_today: 0,
                    total_half_day_today: 0,
                    total_late_today: 0,
                    total_working_today: 0,
                    team_attendance_rate: 0
                },
                message: 'No team members found'
            });
        }

        const { data: teamMembers, error: teamError } = await supabase
            .from('employees')
            .select('employee_id, first_name, last_name, department, designation, joining_date, shift_timing')
            .in('employee_id', teamEmployeeIds);

        if (teamError) throw teamError;

        let targetEmployees = teamMembers;
        if (employee_id && teamEmployeeIds.includes(employee_id)) {
            targetEmployees = teamMembers.filter(emp => emp.employee_id === employee_id);
        }

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        let startDate, endDate;
        if (view_type === 'daily' && start) {
            startDate = start;
            endDate = start;
        } else if (view_type === 'monthly') {
            if (start && end) {
                startDate = start;
                endDate = end;
            } else {
                const currentDate = new Date();
                if (currentDate.getDate() >= 26) {
                    startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 26).toISOString().split('T')[0];
                    endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 25).toISOString().split('T')[0];
                } else {
                    startDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 26).toISOString().split('T')[0];
                    endDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 25).toISOString().split('T')[0];
                }
            }
        } else {
            startDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
            endDate = todayStr;
        }

        console.log(`📅 Date range: ${startDate} to ${endDate}`);

        const { data: attendanceData, error: attendanceError } = await supabase
            .from('attendance')
            .select('*, employees!inner(first_name, last_name, department, shift_timing)')
            .in('employee_id', targetEmployees.map(emp => emp.employee_id))
            .gte('attendance_date', startDate)
            .lte('attendance_date', endDate)
            .order('attendance_date', { ascending: true });

        if (attendanceError) throw attendanceError;

        const { data: leaveData, error: leaveError } = await supabase
            .from('leaves')
            .select('*')
            .in('employee_id', targetEmployees.map(emp => emp.employee_id))
            .eq('status', 'approved')
            .gte('start_date', startDate)
            .lte('end_date', endDate);

        if (leaveError) console.error('Error fetching leaves:', leaveError);

        const leaveMap = {};
        (leaveData || []).forEach(leave => {
            const leaveStart = new Date(leave.start_date);
            const leaveEnd = new Date(leave.end_date);
            for (let d = new Date(leaveStart); d <= leaveEnd; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                const key = `${leave.employee_id}-${dateStr}`;
                leaveMap[key] = { type: leave.leave_type, reason: leave.reason };
            }
        });

        const formattedAttendance = [];
        const dailyStats = {};
        const employeeStats = {};

        targetEmployees.forEach(emp => {
            employeeStats[emp.employee_id] = {
                employee_id: emp.employee_id,
                name: `${emp.first_name} ${emp.last_name}`,
                department: emp.department,
                total_present: 0,
                total_half_day: 0,
                total_absent: 0,
                total_on_leave: 0,
                total_late: 0,
                total_late_minutes: 0,
                total_overtime_hours: 0,
                total_working_hours: 0,
                working_days_count: 0,
                attendance_rate: 0
            };
        });

        const dateRange = [];
        let currentDate = new Date(startDate);
        const endDateTime = new Date(endDate);

        while (currentDate <= endDateTime) {
            const dateStr = currentDate.toISOString().split('T')[0];
            const dayOfWeek = currentDate.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            dateRange.push({ date: dateStr, isWeekend });
            currentDate.setDate(currentDate.getDate() + 1);
        }

        const attendanceMap = {};
        (attendanceData || []).forEach(record => {
            const key = `${record.employee_id}-${record.attendance_date}`;
            attendanceMap[key] = record;
        });

        for (const emp of targetEmployees) {
            for (const { date, isWeekend } of dateRange) {
                const attendanceKey = `${emp.employee_id}-${date}`;
                const attendance = attendanceMap[attendanceKey];
                const leave = leaveMap[attendanceKey];

                let status = 'absent';
                let clockIn = null;
                let clockOut = null;
                let totalHours = 0;
                let lateMinutes = 0;
                let isLate = false;
                let overtimeHours = 0;
                let statusDisplay = 'A';
                let statusColor = 'danger';

                if (isWeekend) {
                    status = 'weekend';
                    statusDisplay = 'W';
                    statusColor = 'secondary';
                } else if (leave) {
                    status = 'on_leave';
                    statusDisplay = 'L';
                    statusColor = 'purple';
                } else if (attendance) {
                    clockIn = attendance.clock_in_ist || attendance.clock_in;
                    clockOut = attendance.clock_out_ist || attendance.clock_out;
                    totalHours = parseFloat(attendance.total_hours) || 0;
                    lateMinutes = parseFloat(attendance.late_minutes) || 0;
                    isLate = lateMinutes > 0;
                    overtimeHours = attendance.overtime_hours || 0;

                    let totalMinutes = 0;
                    if (clockIn && clockOut) {
                        const clockInDate = new Date(clockIn);
                        const clockOutDate = new Date(clockOut);
                        totalMinutes = Math.round((clockOutDate - clockInDate) / (1000 * 60));
                        if (totalMinutes < 0) totalMinutes += 24 * 60;
                        totalHours = totalMinutes / 60;
                    }

                    const shiftTiming = parseShiftTiming(emp.shift_timing);
                    const expectedWorkHours = shiftTiming.totalHours || 9;
                    const expectedWorkMinutes = expectedWorkHours * 60;

                    if (clockIn && clockOut && totalMinutes >= expectedWorkMinutes) {
                        status = 'present';
                        statusDisplay = 'P';
                        statusColor = isLate ? 'warning' : 'success';
                        employeeStats[emp.employee_id].total_present++;
                        employeeStats[emp.employee_id].working_days_count++;
                        employeeStats[emp.employee_id].total_working_hours += totalHours;
                    } else if (clockIn && clockOut && totalMinutes >= 300 && totalMinutes < expectedWorkMinutes) {
                        status = 'half_day';
                        statusDisplay = 'HD';
                        statusColor = 'warning';
                        employeeStats[emp.employee_id].total_half_day++;
                        employeeStats[emp.employee_id].working_days_count++;
                        employeeStats[emp.employee_id].total_working_hours += totalHours;
                    } else if (clockIn && !clockOut) {
                        status = 'working';
                        statusDisplay = 'W';
                        statusColor = 'info';
                        employeeStats[emp.employee_id].working_days_count++;
                        employeeStats[emp.employee_id].total_working_hours += totalHours;
                    } else {
                        employeeStats[emp.employee_id].total_absent++;
                    }

                    if (isLate) {
                        employeeStats[emp.employee_id].total_late++;
                        employeeStats[emp.employee_id].total_late_minutes += lateMinutes;
                    }

                    if (overtimeHours > 0) {
                        employeeStats[emp.employee_id].total_overtime_hours += overtimeHours;
                    }
                } else {
                    employeeStats[emp.employee_id].total_absent++;
                }

                if (date === todayStr) {
                    if (!dailyStats[date]) {
                        dailyStats[date] = {
                            total_employees: targetEmployees.length,
                            present: 0,
                            absent: 0,
                            on_leave: 0,
                            half_day: 0,
                            working: 0,
                            weekend: 0,
                            late_count: 0,
                            present_count: 0
                        };
                    }

                    if (status === 'present') dailyStats[date].present_count++;
                    if (status === 'present') dailyStats[date].present++;
                    if (status === 'absent') dailyStats[date].absent++;
                    if (status === 'on_leave') dailyStats[date].on_leave++;
                    if (status === 'half_day') dailyStats[date].half_day++;
                    if (status === 'working') dailyStats[date].working++;
                    if (status === 'weekend') dailyStats[date].weekend++;
                    if (isLate) dailyStats[date].late_count++;
                }

                formattedAttendance.push({
                    id: attendance?.id || `${emp.employee_id}-${date}`,
                    employee_id: emp.employee_id,
                    employee_name: `${emp.first_name} ${emp.last_name}`,
                    department: emp.department,
                    attendance_date: date,
                    clock_in: clockIn,
                    clock_out: clockOut,
                    total_hours: totalHours.toFixed(1),
                    status: status,
                    status_display: statusDisplay,
                    status_color: statusColor,
                    is_late: isLate,
                    late_minutes: lateMinutes,
                    late_display: lateMinutes > 0 ? formatLateTime(lateMinutes) : null,
                    overtime_hours: overtimeHours,
                    is_weekend: isWeekend,
                    leave_type: leave?.type || null
                });
            }
        }

        const totalWorkingDays = dateRange.filter(d => !d.isWeekend).length;
        const employeeSummary = Object.values(employeeStats).map(emp => {
            const attendanceRate = totalWorkingDays > 0 ? ((emp.total_present + emp.total_half_day) / totalWorkingDays * 100).toFixed(1) : 0;
            return {
                ...emp,
                total_working_days: totalWorkingDays,
                attendance_rate: attendanceRate,
                avg_hours_per_day: emp.working_days_count > 0 ? (emp.total_working_hours / emp.working_days_count).toFixed(1) : 0,
                avg_late_minutes: emp.total_late_count > 0 ? (emp.total_late_minutes / emp.total_late_count).toFixed(0) : 0
            };
        });

        const todayStats = dailyStats[todayStr] || {
            total_employees: targetEmployees.length,
            present: 0,
            absent: 0,
            on_leave: 0,
            half_day: 0,
            working: 0,
            weekend: 0,
            late_count: 0,
            present_count: 0
        };

        res.json({
            success: true,
            team_members: targetEmployees,
            attendance: formattedAttendance,
            date_range: { start: startDate, end: endDate },
            total_working_days: totalWorkingDays,
            daily_stats: todayStats,
            employee_summary: employeeSummary,
            summary: {
                total_team_members: targetEmployees.length,
                total_present_today: todayStats.present_count,
                total_absent_today: todayStats.absent,
                total_on_leave_today: todayStats.on_leave,
                total_half_day_today: todayStats.half_day,
                total_late_today: todayStats.late_count,
                total_working_today: todayStats.working,
                team_attendance_rate: totalWorkingDays > 0 ? (employeeSummary.reduce((sum, e) => sum + parseFloat(e.attendance_rate), 0) / employeeSummary.length).toFixed(1) : 0
            }
        });
    } catch (error) {
        console.error('❌ Error in getTeamAttendanceReport:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch team attendance report', error: error.message });
    }
};

module.exports = exports;