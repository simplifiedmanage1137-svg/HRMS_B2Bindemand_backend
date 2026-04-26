const supabase = require('../config/supabase');

// Helper function to get month name
function getMonthName(monthNumber) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    return months[monthNumber - 1] || 'Unknown';
}

// salaryController.js - Add this check function
const checkTableExists = async (tableName) => {
    try {
        const { data, error } = await supabase
            .from(tableName)
            .select('count', { count: 'exact', head: true })
            .limit(1);

        if (error && error.code === '42P01') {
            return false;
        }
        return true;
    } catch (error) {
        if (error.message && error.message.includes('does not exist')) {
            return false;
        }
        throw error;
    }
};

// Add this at the top of salaryController.js
const setEmployeeContext = async (employeeId, role) => {
    try {
        // Set the current employee ID in the session
        await supabase.rpc('set_employee_context', {
            employee_id: employeeId,
            role: role || 'employee'
        });
    } catch (error) {
        console.log('Could not set employee context, continuing...');
    }
};

const getCycleDates = (month, year) => {
    // April salary = 26 Mar to 25 Apr
    // month=4, year=2026 → start: 2026-03-26, end: 2026-04-25
    const startMonth = month - 1; // previous month (1-based)
    const startYear  = startMonth === 0 ? year - 1 : year;
    const actualStartMonth = startMonth === 0 ? 12 : startMonth;

    // Build date strings directly to avoid UTC offset shifting
    const pad = (n) => String(n).padStart(2, '0');
    const startDateStr = `${startYear}-${pad(actualStartMonth)}-26`;
    const endDateStr   = `${year}-${pad(month)}-25`;

    return {
        startDate:    new Date(`${startDateStr}T00:00:00`),
        endDate:      new Date(`${endDateStr}T00:00:00`),
        startDateStr,
        endDateStr
    };
};

const getCurrentCycle = () => {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    let startYear, startMonth, endYear, endMonth;

    if (today.getDate() >= 26) {
        startYear  = today.getFullYear();
        startMonth = today.getMonth() + 1; // current month
        endYear    = startMonth === 12 ? startYear + 1 : startYear;
        endMonth   = startMonth === 12 ? 1 : startMonth + 1;
    } else {
        endYear    = today.getFullYear();
        endMonth   = today.getMonth() + 1; // current month
        startYear  = endMonth === 1 ? endYear - 1 : endYear;
        startMonth = endMonth === 1 ? 12 : endMonth - 1;
    }

    const startDateStr = `${startYear}-${pad(startMonth)}-26`;
    const endDateStr   = `${endYear}-${pad(endMonth)}-25`;

    return {
        startDate:    new Date(`${startDateStr}T00:00:00`),
        endDate:      new Date(`${endDateStr}T00:00:00`),
        startDateStr,
        endDateStr,
        monthName: new Date(`${endDateStr}T00:00:00`).toLocaleString('default', { month: 'long' }),
        year: endYear
    };
};

exports.generateSalarySlip = async (req, res) => {
    try {
        const { employee_id, month, year } = req.body;

        if (!employee_id || !month || !year) {
            return res.status(400).json({ success: false, message: 'Employee ID, month, and year are required' });
        }

        const tableExists = await checkTableExists('salary_slips');
        if (!tableExists) {
            return res.status(500).json({ success: false, message: 'Salary slips table not created yet.' });
        }

        const { data: employee, error: empError } = await supabase
            .from('employees').select('*').eq('employee_id', employee_id).single();
        if (empError || !employee) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        // Cycle dates: prev month 26th to current month 25th
        const cycle = getCycleDates(parseInt(month), parseInt(year));

        // ── RULE: Salary slip can only be generated from 27th of the salary month ──
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        const cycleEndMonth = parseInt(month);
        const cycleEndYear  = parseInt(year);
        // Earliest allowed date = cycleEnd + 2 days = 27th of salary month
        const allowedFrom = new Date(`${cycleEndYear}-${String(cycleEndMonth).padStart(2,'0')}-27T00:00:00`);
        if (today < allowedFrom) {
            const allowedDateStr = `27 ${new Date(allowedFrom).toLocaleString('en-IN',{month:'long'})} ${cycleEndYear}`;
            return res.status(400).json({
                success: false,
                message: `Salary slip for ${new Date(allowedFrom).toLocaleString('en-IN',{month:'long'})} ${cycleEndYear} can only be generated from ${allowedDateStr}.`
            });
        }

        // Check existing slip
        const { data: existingSlip } = await supabase
            .from('salary_slips').select('*')
            .eq('employee_id', employee_id).eq('month', month).eq('year', year).maybeSingle();
        if (existingSlip) {
            return res.json({ success: true, message: 'Salary slip already exists', salarySlip: existingSlip });
        }

        // ── Count total working days (Mon-Fri) in cycle ──
        let totalWorkingDays = 0;
        let d = new Date(`${cycle.startDateStr}T00:00:00`);
        const cycleEndDate = new Date(`${cycle.endDateStr}T00:00:00`);
        while (d <= cycleEndDate) {
            const dow = d.getDay();
            if (dow !== 0 && dow !== 6) totalWorkingDays++;
            d.setDate(d.getDate() + 1);
        }

        // ── Get attendance records in cycle ──
        const { data: attendanceRecords } = await supabase
            .from('attendance')
            .select('attendance_date, clock_in, clock_out, status, total_minutes')
            .eq('employee_id', employee_id)
            .gte('attendance_date', cycle.startDateStr)
            .lte('attendance_date', cycle.endDateStr);

        // Count present days (has clock_in + clock_out)
        const presentDays = (attendanceRecords || []).filter(a =>
            a.clock_in && a.clock_out
        ).length;

        // ── Get approved leaves in cycle ──
        const { data: leaves } = await supabase
            .from('leaves')
            .select('leave_type, start_date, end_date, days_count, leave_duration')
            .eq('employee_id', employee_id)
            .eq('status', 'approved')
            .lte('start_date', cycle.endDateStr)
            .gte('end_date', cycle.startDateStr);

        // Count unpaid leave days (Mon-Fri only within cycle)
        let unpaidLeaveDays = 0;
        let paidLeaveDays   = 0;
        for (const leave of (leaves || [])) {
            const isUnpaid = leave.leave_type === 'Unpaid';
            const isHalfDay = leave.leave_duration === 'Half Day';

            if (isHalfDay) {
                if (isUnpaid) unpaidLeaveDays += 0.5;
                else paidLeaveDays += 0.5;
                continue;
            }

            // Count Mon-Fri days within cycle overlap
            let ld = new Date(Math.max(new Date(`${leave.start_date}T00:00:00`), new Date(`${cycle.startDateStr}T00:00:00`)));
            const leaveEnd = new Date(Math.min(new Date(`${leave.end_date}T00:00:00`), cycleEndDate));
            while (ld <= leaveEnd) {
                const dow = ld.getDay();
                if (dow !== 0 && dow !== 6) {
                    if (isUnpaid) unpaidLeaveDays++;
                    else paidLeaveDays++;
                }
                ld.setDate(ld.getDate() + 1);
            }
        }

        // Absent days = working days - present - paid leave - unpaid leave
        const absentDays = Math.max(0, totalWorkingDays - presentDays - paidLeaveDays - unpaidLeaveDays);

        // ── Get OT for the cycle period ──
        const { data: otRecords } = await supabase
            .from('attendance')
            .select('overtime_hours, overtime_amount, attendance_date')
            .eq('employee_id', employee_id)
            .gte('attendance_date', cycle.startDateStr)
            .lte('attendance_date', cycle.endDateStr)
            .gt('overtime_hours', 0);

        const overtimeHrs = (otRecords || []).reduce((sum, r) => sum + (parseFloat(r.overtime_hours) || 0), 0);
        const overtimeAmt = parseFloat((overtimeHrs * 150).toFixed(2));

        // ── Salary calculation ──
        const monthlySalary = parseFloat(employee.gross_salary || employee.salary || 0);
        const perDaySalary  = totalWorkingDays > 0 ? monthlySalary / totalWorkingDays : 0;

        // Deduct unpaid leave days only (paid leaves don't reduce salary)
        const unpaidDeduction = parseFloat((unpaidLeaveDays * perDaySalary).toFixed(2));
        const basicSalary     = parseFloat((monthlySalary - unpaidDeduction).toFixed(2));
        const dtDeduction     = 200;
        const netSalary       = parseFloat((basicSalary - dtDeduction + overtimeAmt).toFixed(2));

        console.log('📊 Salary Calculation:', {
            cycle: `${cycle.startDateStr} to ${cycle.endDateStr}`,
            totalWorkingDays, presentDays, paidLeaveDays, unpaidLeaveDays, absentDays,
            monthlySalary, perDaySalary, unpaidDeduction, basicSalary,
            overtimeHrs, overtimeAmt, dtDeduction, netSalary
        });

        const { data: salarySlip, error: insertError } = await supabase
            .from('salary_slips')
            .insert([{
                employee_id, month, year,
                cycle_start_date: cycle.startDateStr,
                cycle_end_date:   cycle.endDateStr,
                total_working_days: totalWorkingDays,
                present_days:       presentDays,
                paid_leave_days:    paidLeaveDays,
                unpaid_leave_days:  unpaidLeaveDays,
                absent_days:        absentDays,
                per_day_salary:     parseFloat(perDaySalary.toFixed(2)),
                unpaid_deduction:   unpaidDeduction,
                monthly_salary:     monthlySalary,
                basic_salary:       basicSalary,
                dt:                 dtDeduction,
                overtime_hours:     overtimeHrs,
                overtime_amount:    overtimeAmt,
                net_salary:         netSalary,
                generated_date:     new Date().toISOString(),
                is_paid:            false
            }])
            .select().single();

        if (insertError) throw insertError;

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

        if (empError) throw empError;

        const joiningDate = new Date(employee.joining_date);
        const joiningInfo = {
            year: joiningDate.getFullYear(),
            month: joiningDate.getMonth() + 1,
            formattedDate: joiningDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })
        };

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

// Get single salary slip
exports.getSalarySlip = async (req, res) => {
    try {
        const { id } = req.params;

        const { data: salarySlip, error } = await supabase
            .from('salary_slips')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        if (!salarySlip) {
            return res.status(404).json({
                success: false,
                message: 'Salary slip not found'
            });
        }

        res.json({
            success: true,
            salarySlip
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

// Get salary slip by ID
exports.getSalarySlipById = async (req, res) => {
    try {
        const { id } = req.params;

        const { data: slips, error } = await supabase
            .from('salary_slips')
            .select(`
                *,
                employees!inner(first_name, last_name, employee_id, department, position, joining_date)
            `)
            .eq('id', id);

        if (error) throw error;

        if (!slips || slips.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Salary slip not found'
            });
        }

        const slip = {
            ...slips[0],
            first_name: slips[0].employees.first_name,
            last_name: slips[0].employees.last_name,
            department: slips[0].employees.department,
            position: slips[0].employees.position,
            joining_date: slips[0].employees.joining_date,
            employees: undefined
        };

        const joiningDate = new Date(slip.joining_date);
        const slipDate = new Date(slip.year, slip.month - 1, 1);

        // Validate that slip is not before joining date
        if (slipDate < joiningDate) {
            return res.status(403).json({
                success: false,
                message: 'Access denied: This salary slip is from before your joining date'
            });
        }

        res.json({
            success: true,
            salarySlip: slip
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

        // First check if employee exists and get joining date
        const { data: employees, error: empError } = await supabase
            .from('employees')
            .select('joining_date')
            .eq('employee_id', employee_id);

        if (empError) throw empError;

        if (!employees || employees.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        const joiningDate = new Date(employees[0].joining_date);
        const requestedDate = new Date(year, month - 1, 1);

        // Validate that requested month is not before joining date
        if (requestedDate < joiningDate) {
            return res.status(403).json({
                success: false,
                message: 'Cannot access salary slips from before your joining date'
            });
        }

        const { data: slips, error } = await supabase
            .from('salary_slips')
            .select(`
                *,
                employees!inner(first_name, last_name, employee_id, department, position)
            `)
            .eq('employee_id', employee_id)
            .eq('month', month)
            .eq('year', year);

        if (error) throw error;

        if (!slips || slips.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Salary slip not found for this month'
            });
        }

        const slip = {
            ...slips[0],
            first_name: slips[0].employees.first_name,
            last_name: slips[0].employees.last_name,
            department: slips[0].employees.department,
            position: slips[0].employees.position,
            employees: undefined
        };

        res.json({
            success: true,
            salarySlip: slip
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

// Generate salary slips for all employees for a specific month (Admin only)
exports.generateBulkSalarySlips = async (req, res) => {
    try {
        const { month, year } = req.body;

        // Get all active employees
        const { data: employees, error: empError } = await supabase
            .from('employees')
            .select('employee_id, salary, gross_salary');

        if (empError) throw empError;

        const results = [];

        for (const emp of employees || []) {
            try {
                // Check if slip already exists
                const { data: existing, error: checkError } = await supabase
                    .from('salary_slips')
                    .select('*')
                    .eq('employee_id', emp.employee_id)
                    .eq('month', month)
                    .eq('year', year);

                if (checkError) throw checkError;

                if (!existing || existing.length === 0) {
                    // Generate salary slip for this employee
                    const rawSalary = String(emp.gross_salary || emp.salary || '0').replace(/[^0-9.]/g, '');
                    const basicSalary = parseFloat(rawSalary) || 0;

                    // SIMPLIFIED CALCULATIONS
                    const grossEarnings = basicSalary;
                    const dt = 200;
                    const totalDeductions = dt;
                    const netSalary = basicSalary - dt;

                    const { error: insertError } = await supabase
                        .from('salary_slips')
                        .insert([{
                            employee_id: emp.employee_id,
                            month,
                            year,
                            basic_salary: basicSalary,
                            hra: 0,
                            conveyance: 0,
                            medical: 0,
                            special: 0,
                            gross_earnings: grossEarnings,
                            pf: 0,
                            esi: 0,
                            tds: 0,
                            pt: 0,
                            dt,
                            total_deductions,
                            net_salary: netSalary,
                            generated_date: new Date().toISOString()
                        }]);

                    if (insertError) throw insertError;

                    results.push({
                        employee_id: emp.employee_id,
                        status: 'success'
                    });
                } else {
                    results.push({
                        employee_id: emp.employee_id,
                        status: 'already_exists'
                    });
                }
            } catch (empError) {
                results.push({
                    employee_id: emp.employee_id,
                    status: 'failed',
                    error: empError.message
                });
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

// Mark salary as paid (Admin only)
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
                notes
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

// Delete salary slip (Admin only)
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

// Get salary statistics (Admin only)
exports.getSalaryStatistics = async (req, res) => {
    try {
        const { year, month } = req.query;

        let query = supabase
            .from('salary_slips')
            .select(`
                *,
                employees!inner(department)
            `);

        if (year) {
            query = query.eq('year', year);
        }
        if (month) {
            query = query.eq('month', month);
        }

        const { data: slips, error } = await query;

        if (error) throw error;

        // Calculate statistics
        const totalEmployees = new Set(slips?.map(s => s.employee_id)).size;
        const totalSalary = slips?.reduce((sum, s) => sum + (parseFloat(s.net_salary) || 0), 0) || 0;
        const paidCount = slips?.filter(s => s.is_paid).length || 0;
        const unpaidCount = slips?.filter(s => !s.is_paid).length || 0;

        // Department-wise breakdown
        const deptStats = {};
        slips?.forEach(slip => {
            const dept = slip.employees?.department || 'Unknown';
            if (!deptStats[dept]) {
                deptStats[dept] = {
                    count: 0,
                    total: 0,
                    paid: 0
                };
            }
            deptStats[dept].count++;
            deptStats[dept].total += parseFloat(slip.net_salary) || 0;
            if (slip.is_paid) {
                deptStats[dept].paid++;
            }
        });

        res.json({
            success: true,
            statistics: {
                total_employees: totalEmployees,
                total_slips: slips?.length || 0,
                total_salary: totalSalary.toFixed(2),
                paid_count: paidCount,
                unpaid_count: unpaidCount,
                department_breakdown: deptStats
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

// Update salary slip (Admin only)
exports.updateSalarySlip = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Remove fields that shouldn't be updated
        delete updates.id;
        delete updates.employee_id;
        delete updates.generated_date;

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