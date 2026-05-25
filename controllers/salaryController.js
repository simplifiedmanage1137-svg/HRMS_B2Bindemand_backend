const supabase = require('../config/supabase');
const { isDateHoliday, getHolidayName } = require('../data/holidays');

const FIXED_WORKING_DAYS = 22;
// Helper function to get month name
function getMonthName(monthNumber) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    return months[monthNumber - 1] || 'Unknown';
}

// Get cycle dates (26th of previous month to 25th of current month)
const getCycleDates = (month, year) => {
    const startMonth = month - 1;
    const startYear = startMonth === 0 ? year - 1 : year;
    const actualStartMonth = startMonth === 0 ? 12 : startMonth;

    const pad = (n) => String(n).padStart(2, '0');
    const startDateStr = `${startYear}-${pad(actualStartMonth)}-26`;
    const endDateStr = `${year}-${pad(month)}-25`;

    return {
        startDate: parseLocalDate(startDateStr),
        endDate: parseLocalDate(endDateStr),
        startDateStr,
        endDateStr,
        startMonth: actualStartMonth,
        startYear: startYear,
        endMonth: month,
        endYear: year
    };
};

// Parse date string YYYY-MM-DD as local date (avoid UTC shift)
const parseLocalDate = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
};

// Calculate working days in cycle (Monday to Friday only)
const calculateWorkingDaysInCycle = (startDate, endDate, joiningDate = null) => {
    let workingDays = 0;
    const start    = parseLocalDate(startDate.toISOString().split('T')[0]);
    const end      = parseLocalDate(endDate.toISOString().split('T')[0]);
    const joinDate = joiningDate
        ? parseLocalDate(joiningDate.toISOString().split('T')[0])
        : null;

    const currentDate = new Date(start);
    while (currentDate <= end) {
        const dayOfWeek = currentDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            if (!joinDate || currentDate >= joinDate) {
                workingDays++;
            }
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }
    return workingDays;
};

// Count company holidays (weekdays only) in cycle
const countHolidaysInCycle = (startDateStr, endDateStr) => {
    const startDate = parseLocalDate(startDateStr);
    const endDate   = parseLocalDate(endDateStr);
    let holidayDays = 0;
    const holidayNames = [];

    const toLocalDateStr = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
        const dayOfWeek = currentDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            const dateStr = toLocalDateStr(currentDate);
            if (isDateHoliday(dateStr)) {
                holidayDays++;
                holidayNames.push({ date: dateStr, name: getHolidayName(dateStr) });
            }
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }
    return { holidayDays, holidayNames };
};

// Calculate days employed in the cycle (for prorated salary)
const calculateDaysEmployedInCycle = (startDate, endDate, joiningDate) => {
    if (!joiningDate) return null;

    const joinDate   = parseLocalDate(joiningDate.toISOString().split('T')[0]);
    const cycleStart = parseLocalDate(startDate.toISOString().split('T')[0]);
    const cycleEnd   = parseLocalDate(endDate.toISOString().split('T')[0]);

    if (joinDate > cycleEnd) return 0;
    if (joinDate <= cycleStart) return null;

    let employedDays = 0;
    let currentDate = new Date(joinDate);

    while (currentDate <= cycleEnd) {
        const dayOfWeek = currentDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            employedDays++;
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return employedDays;
};

// Get employee details
const getEmployeeDetails = async (employeeId) => {
    const { data: employee, error } = await supabase
        .from('employees')
        .select('*')
        .eq('employee_id', employeeId)
        .single();

    if (error) throw error;
    return employee;
};

// Get attendance records for the cycle - best record per day
const getAttendanceRecords = async (employeeId, startDateStr, endDateStr) => {
    const { data: attendance, error } = await supabase
        .from('attendance')
        .select('attendance_date, clock_in, clock_out, status, total_minutes, late_minutes, overtime_hours, overtime_amount')
        .eq('employee_id', employeeId)
        .gte('attendance_date', startDateStr)
        .lte('attendance_date', endDateStr)
        .order('attendance_date', { ascending: true })
        .order('total_minutes', { ascending: false, nullsFirst: false });

    if (error) throw error;

    // Keep best record per day: prefer clocked-out > clocked-in > absent
    const bestPerDay = {};
    for (const rec of (attendance || [])) {
        const dateKey = rec.attendance_date.split('T')[0];
        const existing = bestPerDay[dateKey];
        if (!existing) {
            bestPerDay[dateKey] = rec;
            continue;
        }
        // Prefer record with clock_out over one without
        const existingHasOut = !!existing.clock_out;
        const recHasOut = !!rec.clock_out;
        if (!existingHasOut && recHasOut) {
            bestPerDay[dateKey] = rec;
        } else if (existingHasOut && recHasOut) {
            // Both have clock_out — keep the one with more minutes
            if ((rec.total_minutes || 0) > (existing.total_minutes || 0)) {
                bestPerDay[dateKey] = rec;
            }
        }
    }

    return Object.values(bestPerDay);
};

// Get approved leaves for the cycle
const getApprovedLeaves = async (employeeId, startDateStr, endDateStr) => {
    const { data: leaves, error } = await supabase
        .from('leaves')
        .select('leave_type, start_date, end_date, days_count, leave_duration')
        .eq('employee_id', employeeId)
        .eq('status', 'approved')
        .lte('start_date', endDateStr)
        .gte('end_date', startDateStr);

    if (error) throw error;
    return leaves || [];
};

// Calculate attendance summary
const calculateAttendanceSummary = (attendanceRecords, leaves, startDateStr, endDateStr, joiningDate = null) => {
    const startDate = parseLocalDate(startDateStr);
    const endDate   = parseLocalDate(endDateStr);
    const joinDate  = joiningDate ? parseLocalDate(joiningDate.toISOString().split('T')[0]) : null;

    // Use local date string (YYYY-MM-DD) to avoid UTC offset issues
    const toLocalDateStr = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const attendanceMap = {};
    attendanceRecords.forEach(record => {
        // attendance_date is already YYYY-MM-DD string from DB
        const key = record.attendance_date.split('T')[0];
        attendanceMap[key] = record;
    });

    const leaveMap = {};
    leaves.forEach(leave => {
        const leaveStart = new Date(`${leave.start_date.split('T')[0]}T00:00:00`);
        const leaveEnd   = new Date(`${leave.end_date.split('T')[0]}T00:00:00`);
        for (let d = new Date(leaveStart); d <= leaveEnd; d.setDate(d.getDate() + 1)) {
            const dateStr = toLocalDateStr(d);
            if (!leaveMap[dateStr]) {
                leaveMap[dateStr] = {
                    type: leave.leave_type,
                    duration: leave.leave_duration || 'Full Day'
                };
            }
        }
    });

    let presentDays = 0;
    let halfDays = 0;
    let absentDays = 0;
    let paidLeaveDays = 0;
    let unpaidLeaveDays = 0;
    let totalOvertimeHours = 0;
    let totalOvertimeAmount = 0;
    let totalLateMinutes = 0;
    let lateDays = 0;

    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
        const dateStr    = toLocalDateStr(currentDate);
        const dayOfWeek  = currentDate.getDay();
        const isWeekday  = dayOfWeek !== 0 && dayOfWeek !== 6;

        if (!isWeekday) {
            currentDate.setDate(currentDate.getDate() + 1);
            continue;
        }

        if (joinDate && currentDate < joinDate) {
            currentDate.setDate(currentDate.getDate() + 1);
            continue;
        }

        const attendance = attendanceMap[dateStr];
        const leave      = leaveMap[dateStr];

        if (leave) {
            if (leave.type === 'Unpaid') {
                unpaidLeaveDays += leave.duration === 'Half Day' ? 0.5 : 1;
            } else {
                paidLeaveDays += leave.duration === 'Half Day' ? 0.5 : 1;
            }
        } else if (attendance) {
            // Use DB status field directly — it's already correctly set by clockOut
            // Also handle still-clocked-in (clock_out null but status='present')
            const dbStatus = (attendance.status || '').toLowerCase();
            const totalMinutes = attendance.total_minutes || 0;

            if (dbStatus === 'present') {
                presentDays++;
            } else if (dbStatus === 'half_day') {
                halfDays++;
                presentDays += 0.5;
            } else if (dbStatus === 'absent') {
                absentDays++;
            } else if (attendance.clock_in && !attendance.clock_out) {
                // Still working — count as present for salary
                presentDays++;
            } else if (attendance.clock_in && attendance.clock_out) {
                // Fallback: calculate from total_minutes
                if (totalMinutes >= 9 * 60) {
                    presentDays++;
                } else if (totalMinutes >= 300) {
                    halfDays++;
                    presentDays += 0.5;
                } else {
                    absentDays++;
                }
            } else {
                absentDays++;
            }

            if (attendance.overtime_hours > 0) {
                totalOvertimeHours  += Number(attendance.overtime_hours)  || 0;
                totalOvertimeAmount += Number(attendance.overtime_amount) || 0;
            }
            if (attendance.late_minutes > 0) {
                lateDays++;
                totalLateMinutes += Number(attendance.late_minutes) || 0;
            }
        } else {
            absentDays++;
        }

        currentDate.setDate(currentDate.getDate() + 1);
    }

    return {
        presentDays,
        halfDays,
        absentDays,
        paidLeaveDays,
        unpaidLeaveDays,
        totalOvertimeHours,
        totalOvertimeAmount,
        lateDays,
        totalLateMinutes
    };
};

// Simplified generateSalarySlip function
exports.generateSalarySlip = async (req, res) => {
    try {
        console.log('📝 Generating salary slip with body:', req.body);

        const { employee_id, month, year } = req.body;

        if (!employee_id || !month || !year) {
            return res.status(400).json({ success: false, message: 'Employee ID, month, and year are required' });
        }

        // Get employee details
        const employee = await getEmployeeDetails(employee_id);
        if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

        // Get cycle dates
        const cycle = getCycleDates(parseInt(month), parseInt(year));

        // Check if salary slip already exists — always delete and regenerate fresh
        const { data: existingSlip } = await supabase
            .from('salary_slips').select('id')
            .eq('employee_id', employee_id).eq('month', month).eq('year', year)
            .maybeSingle();

        if (existingSlip) {
            await supabase.from('salary_slips').delete().eq('id', existingSlip.id);
        }

        const monthlySalary = parseFloat(employee.in_hand_salary || employee.gross_salary || employee.salary || 0);
        const joiningDate   = employee.joining_date ? new Date(employee.joining_date) : null;

        // ── 1. Actual working days in cycle (Mon–Fri only, 26th to 25th) ──
        const totalWorkingDays = calculateWorkingDaysInCycle(cycle.startDate, cycle.endDate);

        // ── 2. Per-day salary based on actual cycle working days ──
        const perDaySalary = totalWorkingDays > 0 ? monthlySalary / totalWorkingDays : 0;

        // ── 3. Attendance & leave data ──
        const attendanceRecords = await getAttendanceRecords(employee_id, cycle.startDateStr, cycle.endDateStr);
        const leaveRecords      = await getApprovedLeaves(employee_id, cycle.startDateStr, cycle.endDateStr);

        // ── 4. Count company holidays (weekdays only) in cycle ──
        // Holidays are treated as present days (not deducted)
        const { holidayDays, holidayNames } = countHolidaysInCycle(cycle.startDateStr, cycle.endDateStr);

        // ── 5. Calculate attendance summary ──
        const summary = calculateAttendanceSummary(
            attendanceRecords, leaveRecords,
            cycle.startDateStr, cycle.endDateStr,
            joiningDate
        );

        // ── 6. Salary calculation ──
        // Paid days = present + paid leave + company holidays (holidays always paid)
        const totalPaidDays = summary.presentDays + summary.paidLeaveDays + holidayDays;
        const basicSalary = parseFloat(Math.min(totalPaidDays * perDaySalary, monthlySalary).toFixed(2));

        // Unpaid deduction for record-keeping
        const deductibleDays  = summary.absentDays + summary.unpaidLeaveDays;
        const unpaidDeduction = parseFloat((deductibleDays * perDaySalary).toFixed(2));

        // OT from attendance records
        const overtimeHours  = parseFloat((summary.totalOvertimeHours  || 0).toFixed(2));
        const overtimeAmount = parseFloat((summary.totalOvertimeAmount || 0).toFixed(2));

        // Fixed DT deduction — only apply if employee has some earnings
        const dtDeduction = basicSalary > 0 ? 200 : 0;

        // Net salary
        const netSalary = parseFloat(Math.max(0, basicSalary + overtimeAmount - dtDeduction).toFixed(2));

        const salaryData = {
            employee_id,
            month:              parseInt(month),
            year:               parseInt(year),
            cycle_start_date:   cycle.startDateStr,
            cycle_end_date:     cycle.endDateStr,
            monthly_salary:     monthlySalary,
            per_day_salary:     parseFloat(perDaySalary.toFixed(2)),
            total_working_days: totalWorkingDays,
            present_days:       summary.presentDays,
            half_days:          summary.halfDays,
            absent_days:        summary.absentDays,
            paid_leave_days:    summary.paidLeaveDays,
            unpaid_leave_days:  summary.unpaidLeaveDays,
            unpaid_deduction:   unpaidDeduction,
            basic_salary:       basicSalary,
            overtime_hours:     overtimeHours,
            overtime_amount:    overtimeAmount,
            dt:                 dtDeduction,
            net_salary:         netSalary,
            generated_date:     new Date().toISOString(),
            is_paid:            false
        };

        console.log('📝 Salary calculation (Actual cycle working days):', {
            monthlySalary,
            cycleStart: cycle.startDateStr, cycleEnd: cycle.endDateStr,
            totalWorkingDays, perDaySalary: perDaySalary.toFixed(2),
            presentDays: summary.presentDays, halfDays: summary.halfDays,
            absentDays: summary.absentDays, paidLeaveDays: summary.paidLeaveDays,
            unpaidLeaveDays: summary.unpaidLeaveDays,
            holidayDays, holidayNames,
            totalPaidDays, basicSalary,
            overtimeHours, overtimeAmount, dtDeduction, netSalary
        });

        const { data: salarySlip, error: insertError } = await supabase
            .from('salary_slips').insert([salaryData]).select().single();

        if (insertError) {
            console.error('❌ Insert error:', insertError);
            return res.status(500).json({ success: false, message: 'Failed to insert salary slip', error: insertError.message });
        }

        res.json({ success: true, message: 'Salary slip generated successfully', salarySlip });

    } catch (error) {
        console.error('❌ Error generating salary slip:', error);
        res.status(500).json({ success: false, message: 'Failed to generate salary slip', error: error.message });
    }
};
// Get salary slips for employee
exports.getEmployeeSalarySlips = async (req, res) => {
    try {
        const { employee_id } = req.params;

        const { data: salarySlips, error } = await supabase
            .from('salary_slips')
            .select('*')
            .eq('employee_id', employee_id)
            .order('year', { ascending: false })
            .order('month', { ascending: false });

        if (error) throw error;

        // Get employee joining info
        const { data: employee, error: empError } = await supabase
            .from('employees')
            .select('joining_date')
            .eq('employee_id', employee_id)
            .single();

        let joiningInfo = null;
        if (employee && !empError) {
            const joiningDate = new Date(employee.joining_date);
            joiningInfo = {
                year: joiningDate.getFullYear(),
                month: joiningDate.getMonth() + 1,
                formattedDate: joiningDate.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                })
            };
        }

        res.json({
            success: true,
            salarySlips: salarySlips || [],
            joiningInfo
        });

    } catch (error) {
        console.error('Error fetching salary slips:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch salary slips',
            error: error.message
        });
    }
};

// Get salary slip by ID
exports.getSalarySlipById = async (req, res) => {
    try {
        const { id } = req.params;

        const { data: slips, error } = await supabase
            .from('salary_slips')
            .select('*')
            .eq('id', id);

        if (error) throw error;

        if (!slips || slips.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Salary slip not found'
            });
        }

        res.json({
            success: true,
            salarySlip: slips[0]
        });

    } catch (error) {
        console.error('Error fetching salary slip:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch salary slip',
            error: error.message
        });
    }
};

// Get salary slip by month and year
exports.getSalarySlipByMonth = async (req, res) => {
    try {
        const { employee_id, month, year } = req.params;

        const { data: slips, error } = await supabase
            .from('salary_slips')
            .select('*')
            .eq('employee_id', employee_id)
            .eq('month', parseInt(month))
            .eq('year', parseInt(year));

        if (error) throw error;

        if (!slips || slips.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Salary slip not found for this month'
            });
        }

        res.json({
            success: true,
            salarySlip: slips[0]
        });

    } catch (error) {
        console.error('Error fetching salary slip:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch salary slip',
            error: error.message
        });
    }
};

// Generate bulk salary slips
exports.generateBulkSalarySlips = async (req, res) => {
    try {
        const { month, year } = req.body;

        const { data: employees, error: empError } = await supabase
            .from('employees')
            .select('employee_id');

        if (empError) throw empError;

        const results = [];

        for (const emp of employees || []) {
            try {
                const { data: existing } = await supabase
                    .from('salary_slips')
                    .select('*')
                    .eq('employee_id', emp.employee_id)
                    .eq('month', month)
                    .eq('year', year);

                if (!existing || existing.length === 0) {
                    const genReq = { body: { employee_id: emp.employee_id, month, year } };
                    const genRes = { json: (data) => results.push({ employee_id: emp.employee_id, ...data }), status: () => genRes };
                    await exports.generateSalarySlip(genReq, genRes);
                } else {
                    results.push({ employee_id: emp.employee_id, status: 'already_exists' });
                }
            } catch (empError) {
                results.push({ employee_id: emp.employee_id, status: 'failed', error: empError.message });
            }
        }

        res.json({
            success: true,
            message: 'Bulk salary slip generation completed',
            results
        });

    } catch (error) {
        console.error('Error generating bulk salary slips:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate bulk salary slips',
            error: error.message
        });
    }
};

// Mark salary as paid
exports.markAsPaid = async (req, res) => {
    try {
        const { id } = req.params;
        const { payment_mode, notes } = req.body;

        const { data, error } = await supabase
            .from('salary_slips')
            .update({
                is_paid: true,
                payment_date: new Date().toISOString().split('T')[0],
                payment_mode,
                notes,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select();

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Salary slip not found'
            });
        }

        res.json({
            success: true,
            message: 'Salary marked as paid',
            salarySlip: data[0]
        });

    } catch (error) {
        console.error('Error marking salary as paid:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark salary as paid',
            error: error.message
        });
    }
};

// Delete salary slip
exports.deleteSalarySlip = async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('salary_slips')
            .delete()
            .eq('id', id)
            .select();

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Salary slip not found'
            });
        }

        res.json({
            success: true,
            message: 'Salary slip deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting salary slip:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete salary slip',
            error: error.message
        });
    }
};

// Get salary statistics
exports.getSalaryStatistics = async (req, res) => {
    try {
        const { year, month } = req.query;

        let query = supabase
            .from('salary_slips')
            .select('*');

        if (year) {
            query = query.eq('year', year);
        }
        if (month) {
            query = query.eq('month', month);
        }

        const { data: slips, error } = await query;

        if (error) throw error;

        const totalEmployees = new Set(slips?.map(s => s.employee_id)).size;
        const totalSalary = slips?.reduce((sum, s) => sum + (parseFloat(s.net_salary) || 0), 0) || 0;
        const paidCount = slips?.filter(s => s.is_paid).length || 0;
        const unpaidCount = slips?.filter(s => !s.is_paid).length || 0;

        res.json({
            success: true,
            statistics: {
                total_employees: totalEmployees,
                total_slips: slips?.length || 0,
                total_salary: totalSalary.toFixed(2),
                paid_count: paidCount,
                unpaid_count: unpaidCount
            }
        });

    } catch (error) {
        console.error('Error fetching salary statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch salary statistics',
            error: error.message
        });
    }
};

// Update salary slip
exports.updateSalarySlip = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        delete updates.id;
        delete updates.employee_id;
        delete updates.generated_date;
        updates.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from('salary_slips')
            .update(updates)
            .eq('id', id)
            .select();

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Salary slip not found'
            });
        }

        res.json({
            success: true,
            message: 'Salary slip updated successfully',
            salarySlip: data[0]
        });

    } catch (error) {
        console.error('Error updating salary slip:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update salary slip',
            error: error.message
        });
    }
};