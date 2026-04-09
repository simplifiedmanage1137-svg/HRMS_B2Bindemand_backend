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
    // When generating salary for a specific month (e.g., April 2026)
    // The cycle is from March 26 to April 25
    const cycleStart = new Date(year, month - 2, 26); // Previous month 26th
    const cycleEnd = new Date(year, month - 1, 25);   // Current month 25th
    
    return {
        startDate: cycleStart,
        endDate: cycleEnd,
        startDateStr: cycleStart.toISOString().split('T')[0],
        endDateStr: cycleEnd.toISOString().split('T')[0]
    };
};

const getCurrentCycle = () => {
    const today = new Date();
    let cycleStart, cycleEnd;
    
    if (today.getDate() >= 26) {
        // Cycle: 26th current month to 25th next month
        cycleStart = new Date(today.getFullYear(), today.getMonth(), 26);
        cycleEnd = new Date(today.getFullYear(), today.getMonth() + 1, 25);
    } else {
        // Cycle: 26th previous month to 25th current month
        cycleStart = new Date(today.getFullYear(), today.getMonth() - 1, 26);
        cycleEnd = new Date(today.getFullYear(), today.getMonth(), 25);
    }
    
    return {
        startDate: cycleStart,
        endDate: cycleEnd,
        startDateStr: cycleStart.toISOString().split('T')[0],
        endDateStr: cycleEnd.toISOString().split('T')[0],
        monthName: cycleEnd.toLocaleString('default', { month: 'long' }),
        year: cycleEnd.getFullYear()
    };
};

// Modify the generateSalarySlip function
exports.generateSalarySlip = async (req, res) => {
    try {
        console.log('='.repeat(70));
        console.log('💰 GENERATING SALARY SLIP');
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        console.log('='.repeat(70));

        const { employee_id, month, year, overtime_amount, overtime_hours } = req.body;
        const currentUserId = req.user?.employeeId;
        const currentUserRole = req.user?.role;

        if (!employee_id || !month || !year) {
            return res.status(400).json({
                success: false,
                message: 'Employee ID, month, and year are required'
            });
        }

        // Check if user has permission
        if (currentUserRole !== 'admin' && currentUserId !== employee_id) {
            return res.status(403).json({
                success: false,
                message: 'You can only generate salary slips for yourself'
            });
        }

        // Get cycle dates based on month/year
        const cycle = getCycleDates(month, year);
        console.log('📅 Salary Cycle:', {
            start: cycle.startDateStr,
            end: cycle.endDateStr,
            month: month,
            year: year
        });

        // Get employee details
        const { data: employee, error: empError } = await supabase
            .from('employees')
            .select('*')
            .eq('employee_id', employee_id)
            .single();

        if (empError || !employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Get attendance for the cycle
        const { data: attendance, error: attError } = await supabase
            .from('attendance')
            .select('*')
            .eq('employee_id', employee_id)
            .gte('attendance_date', cycle.startDateStr)
            .lte('attendance_date', cycle.endDateStr);

        if (attError) throw attError;

        // Calculate working days in cycle
        let totalWorkingDays = 0;
        let presentDays = 0;
        let halfDays = 0;
        let absentDays = 0;
        let unpaidLeaveDays = 0;

        // Get all dates in cycle
        const cycleDates = [];
        let currentDate = new Date(cycle.startDate);
        
        while (currentDate <= cycle.endDate) {
            cycleDates.push(new Date(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Get employee leaves for the cycle
        const { data: leaves, error: leaveError } = await supabase
            .from('leaves')
            .select('*')
            .eq('employee_id', employee_id)
            .eq('status', 'approved')
            .gte('start_date', cycle.startDateStr)
            .lte('end_date', cycle.endDateStr);

        if (leaveError) throw leaveError;

        // Process each day in cycle
        for (const date of cycleDates) {
            const dateStr = date.toISOString().split('T')[0];
            const dayOfWeek = date.getDay();
            const isWeeklyOff = dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
            
            // Check if it's a holiday
            const isHoliday = holidays.some(h => h.date === dateStr);
            
            // Check if it's a leave day
            const leave = leaves?.find(l => 
                dateStr >= l.start_date && dateStr <= l.end_date
            );
            
            // Check attendance record
            const attRecord = attendance?.find(a => a.attendance_date === dateStr);
            
            if (isWeeklyOff) {
                // Weekly off - no salary calculation
                continue;
            }
            
            totalWorkingDays++;
            
            if (leave) {
                if (leave.leave_type === 'Unpaid') {
                    unpaidLeaveDays++;
                } else {
                    // Paid leave - counted as present
                    presentDays++;
                }
            } else if (attRecord) {
                if (attRecord.status === 'present' || attRecord.status === 'working' || attRecord.clock_in) {
                    presentDays++;
                } else if (attRecord.status === 'half_day') {
                    halfDays++;
                    presentDays += 0.5;
                } else if (attRecord.status === 'absent') {
                    absentDays++;
                }
            } else {
                // No record - absent
                absentDays++;
            }
        }

        // Calculate salary components
        const monthlySalary = parseFloat(employee.gross_salary || employee.salary || 0);
        const perDaySalary = monthlySalary / totalWorkingDays;
        
        // Calculate salary after deductions
        const unpaidDeduction = unpaidLeaveDays * perDaySalary;
        const basicSalary = monthlySalary - unpaidDeduction;
        const dtDeduction = 200;
        const overtimeAmt = parseFloat(overtime_amount) || 0;
        const overtimeHrs = parseFloat(overtime_hours) || 0;
        const netSalary = basicSalary - dtDeduction + overtimeAmt;

        console.log('📊 Salary Calculation:', {
            monthlySalary,
            totalWorkingDays,
            perDaySalary,
            presentDays,
            halfDays,
            absentDays,
            unpaidLeaveDays,
            unpaidDeduction,
            basicSalary,
            dtDeduction,
            overtimeAmt,
            netSalary,
            cycle: `${cycle.startDateStr} to ${cycle.endDateStr}`
        });

        // Check if salary slip already exists
        const { data: existingSlip, error: checkError } = await supabase
            .from('salary_slips')
            .select('*')
            .eq('employee_id', employee_id)
            .eq('month', month)
            .eq('year', year)
            .maybeSingle();

        if (checkError) throw checkError;

        if (existingSlip) {
            return res.json({
                success: true,
                message: 'Salary slip already exists',
                salarySlip: existingSlip
            });
        }

        // Create salary slip with cycle information
        const { data: salarySlip, error: insertError } = await supabase
            .from('salary_slips')
            .insert([{
                employee_id,
                month,
                year,
                cycle_start_date: cycle.startDateStr,
                cycle_end_date: cycle.endDateStr,
                total_working_days: totalWorkingDays,
                present_days: presentDays,
                half_days: halfDays,
                absent_days: absentDays,
                unpaid_leave_days: unpaidLeaveDays,
                monthly_salary: monthlySalary,
                per_day_salary: perDaySalary,
                unpaid_deduction: unpaidDeduction,
                basic_salary: basicSalary,
                dt: dtDeduction,
                overtime_hours: overtimeHrs,
                overtime_amount: overtimeAmt,
                net_salary: netSalary,
                generated_date: new Date().toISOString(),
                is_paid: false
            }])
            .select()
            .single();

        if (insertError) {
            console.error('❌ Insert error:', insertError);
            throw insertError;
        }

        console.log('✅ Salary slip generated:', salarySlip);

        res.json({
            success: true,
            message: 'Salary slip generated successfully',
            salarySlip,
            cycle_info: {
                start_date: cycle.startDateStr,
                end_date: cycle.endDateStr,
                total_working_days: totalWorkingDays,
                present_days: presentDays,
                absent_days: absentDays,
                unpaid_leave_days: unpaidLeaveDays
            }
        });

    } catch (error) {
        console.error('❌ Error generating salary slip:', error);
        
        res.status(500).json({
            success: false,
            message: 'Failed to generate salary slip',
            error: error.message,
            details: error.details
        });
    }
};

// Modify the generateSalarySlip function
exports.generateSalarySlip = async (req, res) => {
    try {
        console.log('='.repeat(70));
        console.log('💰 GENERATING SALARY SLIP');
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        console.log('='.repeat(70));

        const { employee_id, month, year, overtime_amount, overtime_hours } = req.body;

        if (!employee_id || !month || !year) {
            return res.status(400).json({
                success: false,
                message: 'Employee ID, month, and year are required'
            });
        }

        // Check if table exists
        const tableExists = await checkTableExists('salary_slips');

        if (!tableExists) {
            console.log('⚠️ salary_slips table does not exist');
            return res.status(500).json({
                success: false,
                message: 'Salary slips table not created yet. Please contact admin to create the table.',
                error: 'Table salary_slips does not exist in database'
            });
        }

        // Get employee details
        const { data: employee, error: empError } = await supabase
            .from('employees')
            .select('*')
            .eq('employee_id', employee_id)
            .single();

        if (empError || !employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Check if salary slip already exists
        const { data: existingSlip, error: checkError } = await supabase
            .from('salary_slips')
            .select('*')
            .eq('employee_id', employee_id)
            .eq('month', month)
            .eq('year', year)
            .maybeSingle();

        if (checkError) throw checkError;

        if (existingSlip) {
            return res.json({
                success: true,
                message: 'Salary slip already exists',
                salarySlip: existingSlip
            });
        }

        // Calculate salary components
        const basicSalary = parseFloat(employee.gross_salary || employee.salary || 0);
        const dtDeduction = 200;
        const overtimeAmt = parseFloat(overtime_amount) || 0;
        const overtimeHrs = parseFloat(overtime_hours) || 0;
        const netSalary = basicSalary - dtDeduction + overtimeAmt;

        console.log('📊 Salary calculation:', {
            basicSalary,
            dtDeduction,
            overtimeAmt,
            overtimeHrs,
            netSalary
        });

        // Create salary slip
        const { data: salarySlip, error: insertError } = await supabase
            .from('salary_slips')
            .insert([{
                employee_id,
                month,
                year,
                basic_salary: basicSalary,
                dt: dtDeduction,
                overtime_hours: overtimeHrs,
                overtime_amount: overtimeAmt,
                net_salary: netSalary,
                generated_date: new Date().toISOString(),
                is_paid: false
            }])
            .select()
            .single();

        if (insertError) {
            console.error('❌ Insert error:', insertError);
            throw insertError;
        }

        console.log('✅ Salary slip generated:', salarySlip);

        res.json({
            success: true,
            message: 'Salary slip generated successfully',
            salarySlip
        });

    } catch (error) {
        console.error('❌ Error generating salary slip:', error);

        // Check for table not exists error
        if (error.message && error.message.includes('does not exist')) {
            return res.status(500).json({
                success: false,
                message: 'Salary slips table not created yet. Please contact admin.',
                error: 'Table salary_slips does not exist'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to generate salary slip',
            error: error.message
        });
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