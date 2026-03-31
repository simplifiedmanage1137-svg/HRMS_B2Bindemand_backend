// controllers/leaveController.js
const LeaveYearlyService = require('../services/leaveYearlyService');
const supabase = require('../config/supabase');

// In leaveController.js - Updated getLeaveBalance
exports.getLeaveBalance = async (req, res) => {
    try {
        const { employee_id } = req.params;

        console.log('📊 Fetching leave balance for employee:', employee_id);

        // Get employee details
        const { data: employee, error: empError } = await supabase
            .from('employees')
            .select('joining_date, comp_off_balance')
            .eq('employee_id', employee_id)
            .single();

        if (empError) throw empError;

        const joiningDate = new Date(employee.joining_date);
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();
        const currentDate = today.getDate();

        // Get last day of current month
        const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const isLastDayOfMonth = currentDate === lastDayOfMonth;
        const currentHour = today.getHours();
        const isAfter11PM = currentHour >= 23;

        // Check if we should include current month's accrual
        let includeCurrentMonthAccrual = false;
        if (isLastDayOfMonth && isAfter11PM) {
            includeCurrentMonthAccrual = true;
        } else if (currentDate > lastDayOfMonth) {
            includeCurrentMonthAccrual = true;
        }

        // Calculate months from joining to current date (including current month if complete)
        let monthsFromJoining = (today.getFullYear() - joiningDate.getFullYear()) * 12;
        monthsFromJoining += (today.getMonth() - joiningDate.getMonth());

        // Adjust for day of month
        if (today.getDate() < joiningDate.getDate()) {
            monthsFromJoining -= 1;
        }

        // Add 1 if current month is complete
        if (includeCurrentMonthAccrual) {
            monthsFromJoining = Math.max(0, monthsFromJoining + 1);
        }
        monthsFromJoining = Math.max(0, monthsFromJoining);

        // Calculate total accrued leaves from joining (1.5 per month)
        // ✅ FIX: Show accrued leaves even during probation
        const totalAccruedOverall = monthsFromJoining * 1.5;

        // Calculate current year's accrual (for display)
        let currentYearAccrual = 0;
        let accrualMonthsThisYear = 0;

        if (joiningDate.getFullYear() === currentYear) {
            // Joined this year
            const joinMonth = joiningDate.getMonth();
            let monthsThisYear = currentMonth - joinMonth;

            if (includeCurrentMonthAccrual) {
                monthsThisYear += 1;
            }
            if (today.getDate() < joiningDate.getDate()) {
                monthsThisYear -= 1;
            }
            accrualMonthsThisYear = Math.max(0, monthsThisYear);
            currentYearAccrual = accrualMonthsThisYear * 1.5;
        } else {
            // Joined in previous years
            let monthsThisYear = currentMonth + 1; // Jan = 1 month
            if (!includeCurrentMonthAccrual && currentDate <= lastDayOfMonth) {
                monthsThisYear = Math.max(0, monthsThisYear - 1);
            }
            accrualMonthsThisYear = monthsThisYear;
            currentYearAccrual = accrualMonthsThisYear * 1.5;
        }

        // Check probation status (6 months from joining)
        const isProbationComplete = monthsFromJoining >= 6;

        // Calculate eligible from date
        const eligibleFromDate = new Date(joiningDate);
        eligibleFromDate.setMonth(eligibleFromDate.getMonth() + 6);
        const eligibleFromDateStr = eligibleFromDate.toISOString().split('T')[0];

        // Get used leaves for current year
        const { data: usedLeaves, error: usedError } = await supabase
            .from('leaves')
            .select('days_count')
            .eq('employee_id', employee_id)
            .eq('status', 'approved')
            .in('leave_type', ['Annual', 'Sick', 'Personal', 'Maternity', 'Paternity', 'Bereavement'])
            .gte('start_date', `${currentYear}-01-01`)
            .lte('start_date', `${currentYear}-12-31`);

        if (usedError) throw usedError;
        const used = usedLeaves?.reduce((sum, leave) => sum + (leave.days_count || 0), 0) || 0;

        // Get pending leaves for current year
        const { data: pendingLeaves, error: pendingError } = await supabase
            .from('leaves')
            .select('days_count')
            .eq('employee_id', employee_id)
            .eq('status', 'pending')
            .in('leave_type', ['Annual', 'Sick', 'Personal', 'Maternity', 'Paternity', 'Bereavement'])
            .gte('start_date', `${currentYear}-01-01`)
            .lte('start_date', `${currentYear}-12-31`);

        if (pendingError) throw pendingError;
        const pending = pendingLeaves?.reduce((sum, leave) => sum + (leave.days_count || 0), 0) || 0;

        // ✅ FIX: Calculate available balance
        // During probation: available = 0 (can't use), but total_accrued shows accumulated leaves
        // After probation: available = total_accrued - used - pending
        let available = 0;
        let usableLeaves = 0;

        if (isProbationComplete) {
            // After probation - can use all accrued leaves
            usableLeaves = currentYearAccrual;
            available = Math.max(0, currentYearAccrual - used - pending);
        } else {
            // During probation - leaves are accruing but cannot be used
            usableLeaves = 0;
            available = 0;
        }

        console.log('📊 Leave Calculation:', {
            joining_date: employee.joining_date,
            months_from_joining: monthsFromJoining,
            total_accrued_overall: totalAccruedOverall,
            current_year_accrual: currentYearAccrual,
            accrual_months_this_year: accrualMonthsThisYear,
            used: used,
            pending: pending,
            available: available,
            usable_leaves: usableLeaves,
            is_probation_complete: isProbationComplete
        });

        // Update or create balance record
        const { error: upsertError } = await supabase
            .from('leave_balance')
            .upsert({
                employee_id,
                leave_year: currentYear,
                total_accrued: currentYearAccrual,
                total_used: used,
                total_pending: pending,
                current_balance: available,
                last_updated: today.toISOString()
            }, {
                onConflict: 'employee_id,leave_year'
            });

        if (upsertError) console.error('Upsert error:', upsertError);

        res.json({
            success: true,
            total_accrued: currentYearAccrual.toFixed(1),
            used: used.toFixed(1),
            pending: pending.toFixed(1),
            available: available.toFixed(1),
            comp_off_balance: (employee.comp_off_balance || 0).toFixed(1),
            months_completed: monthsFromJoining,
            is_probation_complete: isProbationComplete,  // ✅ Make sure this exists
            is_eligible: isProbationComplete,
            eligible_from_date: eligibleFromDateStr,
            leave_year: currentYear,
            joining_date: employee.joining_date,
            probation_info: {
                is_active: !isProbationComplete,
                months_completed: monthsFromJoining,
                months_remaining: Math.max(0, 6 - monthsFromJoining),
                eligible_from_date: eligibleFromDateStr,
                accrued_but_unusable: !isProbationComplete ? currentYearAccrual : 0
            }
        });

    } catch (error) {
        console.error('Error fetching leave balance:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch leave balance',
            error: error.message
        });
    }
};

// In leaveController.js - Updated applyLeave function
exports.applyLeave = async (req, res) => {
    try {
        console.log('='.repeat(50));
        console.log('📝 LEAVE APPLICATION');
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        console.log('='.repeat(50));

        const {
            employee_id,
            leave_type,
            leave_duration,
            half_day_type,
            start_date,
            end_date,
            reason,
            days_count,
            reporting_manager
        } = req.body;

        // Validation
        if (!employee_id || !leave_type || !start_date || !reason) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // Get employee details
        const { data: employee, error: empError } = await supabase
            .from('employees')
            .select('joining_date, comp_off_balance')
            .eq('employee_id', employee_id)
            .single();

        if (empError) throw empError;

        // Calculate months completed
        const joiningDate = new Date(employee.joining_date);
        const today = new Date();

        let monthsCompleted = (today.getFullYear() - joiningDate.getFullYear()) * 12;
        monthsCompleted += (today.getMonth() - joiningDate.getMonth());

        if (today.getDate() < joiningDate.getDate()) {
            monthsCompleted -= 1;
        }

        monthsCompleted = Math.max(0, monthsCompleted);
        const isProbationComplete = monthsCompleted >= 6;

        // Check leave eligibility based on probation status
        if (!isProbationComplete) {
            // During probation - only Unpaid and Comp-Off allowed
            if (leave_type !== 'Unpaid' && leave_type !== 'Comp-Off') {
                return res.status(400).json({
                    success: false,
                    message: `During probation period (${monthsCompleted}/6 months completed), you can only apply for Unpaid Leave or Comp-Off. You will be eligible for paid leaves after ${6 - monthsCompleted} more month(s).`,
                    probation_status: {
                        months_completed: monthsCompleted,
                        months_remaining: 6 - monthsCompleted,
                        eligible_from_date: new Date(joiningDate.setMonth(joiningDate.getMonth() + 6)).toISOString().split('T')[0]
                    }
                });
            }
        }

        // Check leave balance for paid leaves (only if probation is complete)
        if (isProbationComplete && leave_type !== 'Unpaid' && leave_type !== 'Comp-Off') {
            const { data: balanceData, error: balanceError } = await supabase
                .from('leave_balance')
                .select('current_balance')
                .eq('employee_id', employee_id)
                .eq('leave_year', today.getFullYear())
                .maybeSingle();

            if (balanceError) throw balanceError;

            const available = balanceData?.current_balance || 0;

            if (available < days_count) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient leave balance. Available: ${available.toFixed(1)} days. You need ${days_count} days.`,
                    current_balance: available,
                    required: days_count
                });
            }
        }

        // Check comp-off balance
        if (leave_type === 'Comp-Off') {
            if ((employee.comp_off_balance || 0) < days_count) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient Comp-Off balance. Available: ${employee.comp_off_balance || 0} days`
                });
            }
        }

        // Insert leave record
        const { data: leaveData, error: leaveError } = await supabase
            .from('leaves')
            .insert([{
                employee_id,
                leave_type,
                leave_duration,
                half_day_type: half_day_type || null,
                start_date,
                end_date: end_date || start_date,
                reason,
                days_count: days_count || 1,
                reporting_manager: reporting_manager || null,
                status: 'pending',
                applied_date: new Date().toISOString().split('T')[0],
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }])
            .select();

        if (leaveError) {
            console.error('❌ Leave insert error:', leaveError);
            return res.status(500).json({
                success: false,
                message: 'Failed to submit leave request',
                error: leaveError.message,
                details: leaveError
            });
        }

        console.log('✅ Leave applied successfully:', leaveData[0]);

        // Prepare response message
        let message = '';
        if (leave_type === 'Comp-Off') {
            message = 'Comp-Off request submitted successfully!';
        } else if (!isProbationComplete) {
            message = `Leave request submitted successfully! Note: You are still in probation (${monthsCompleted}/6 months). This will be treated as Unpaid Leave.`;
        } else {
            message = 'Leave request submitted successfully!';
        }

        res.json({
            success: true,
            message: message,
            leave: leaveData[0],
            probation_status: !isProbationComplete ? {
                is_active: true,
                months_completed: monthsCompleted,
                months_remaining: 6 - monthsCompleted,
                eligible_from_date: new Date(joiningDate.setMonth(joiningDate.getMonth() + 6)).toISOString().split('T')[0]
            } : null
        });

    } catch (error) {
        console.error('❌ Error applying leave:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            message: 'Failed to apply leave',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

// Helper function to parse shift timing
const parseShiftTiming = (shiftString) => {
    if (!shiftString) {
        return {
            startHour: 9,
            startMinute: 0,
            endHour: 18,
            endMinute: 0,
            totalHours: 9
        };
    }

    const parts = shiftString.split('-');
    if (parts.length !== 2) {
        return {
            startHour: 9,
            startMinute: 0,
            endHour: 18,
            endMinute: 0,
            totalHours: 9
        };
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
        return {
            startHour: 9,
            startMinute: 0,
            endHour: 18,
            endMinute: 0,
            totalHours: 9
        };
    }

    let totalHours = endTime.hour - startTime.hour;
    if (totalHours < 0) totalHours += 24;
    totalHours += (endTime.minute - startTime.minute) / 60;

    return {
        startHour: startTime.hour,
        startMinute: startTime.minute,
        endHour: endTime.hour,
        endMinute: endTime.minute,
        totalHours: totalHours
    };
};

// Validate half-day based on shift and working hours - 5 HOURS RULE
const validateHalfDay = async (employee_id, leaveDate, halfDayType, shiftTiming) => {
    try {
        const date = new Date(leaveDate);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();

        const { data: attendance, error: attError } = await supabase
            .from('attendance')
            .select('*')
            .eq('employee_id', employee_id)
            .eq('attendance_date', leaveDate);

        if (attError) throw attError;

        let hoursWorked = 0;

        if (attendance && attendance.length > 0) {
            if (attendance[0].clock_in && attendance[0].clock_out) {
                const clockInTime = new Date(attendance[0].clock_in);
                const clockOutTime = new Date(attendance[0].clock_out);
                hoursWorked = (clockOutTime - clockInTime) / (1000 * 60 * 60);
            }
        }

        const totalShiftHours = shiftTiming.totalHours;
        const MINIMUM_REQUIRED_HOURS = 5;

        let requiredHours = 0;
        let remainingHalf = '';

        if (halfDayType === 'First Half') {
            remainingHalf = 'Second Half';
            requiredHours = MINIMUM_REQUIRED_HOURS;
        } else if (halfDayType === 'Second Half') {
            remainingHalf = 'First Half';
            requiredHours = MINIMUM_REQUIRED_HOURS;
        }

        console.log('Half-day validation (5-hour rule):', {
            halfDayType,
            remainingHalf,
            requiredHours: requiredHours.toFixed(1),
            hoursWorked: hoursWorked.toFixed(1),
            shiftTiming,
            totalShiftHours: totalShiftHours.toFixed(1)
        });

        if (hoursWorked >= requiredHours) {
            return {
                valid: true,
                message: `Valid half-day leave. You worked ${hoursWorked.toFixed(1)} hours in the ${remainingHalf} (minimum 5 hours required).`
            };
        } else {
            return {
                valid: false,
                message: `Insufficient work hours. You only worked ${hoursWorked.toFixed(1)} hours in the ${remainingHalf}. Minimum 5 hours required for half-day.`
            };
        }

    } catch (error) {
        console.error('Error validating half-day:', error);
        return {
            valid: false,
            message: 'Unable to validate work hours.'
        };
    }
};

// controllers/leaveController.js - COMPLETE FIX
exports.getLeaves = async (req, res) => {
    try {
        // IMPORTANT: Get the authenticated user from the token
        const authenticatedUserId = req.user?.employeeId;
        const userRole = req.user?.role;

        console.log('📋 Fetching leaves - User:', {
            employeeId: authenticatedUserId,
            role: userRole
        });

        let query = supabase
            .from('leaves')
            .select('*');

        // CRITICAL: Filter based on authenticated user
        // Filter by employee_id unless admin explicitly requests all
        if (!(userRole === 'admin' && req.query.all === 'true')) {
            if (!authenticatedUserId) {
                console.log('❌ No authenticated user ID found');
                return res.json([]);
            }
            console.log('👤 Filtering leaves for user:', authenticatedUserId);
            query = query.eq('employee_id', authenticatedUserId);
        } else {
            console.log('👑 Admin user - fetching all leaves');
            // Optional: Filter by specific employee if provided in query
            if (req.query.employee_id) {
                query = query.eq('employee_id', req.query.employee_id);
                console.log('📌 Filtering by specific employee:', req.query.employee_id);
            }
        }

        query = query.order('applied_date', { ascending: false });

        const { data: leaves, error } = await query;

        if (error) {
            console.error('❌ Database error:', error);
            throw error;
        }

        console.log(`✅ Found ${leaves?.length || 0} leaves for ${userRole === 'admin' ? 'admin' : `employee ${authenticatedUserId}`}`);

        if (!leaves || leaves.length === 0) {
            return res.json([]);
        }

        // Format leaves with employee details
        const formattedLeaves = [];

        for (const leave of leaves) {
            try {
                // Only fetch employee details if needed (for admin view)
                if (userRole === 'admin') {
                    const { data: employee, error: empError } = await supabase
                        .from('employees')
                        .select('first_name, last_name, department, designation')
                        .eq('employee_id', leave.employee_id)
                        .single();

                    if (empError) {
                        console.warn(`⚠️ Could not fetch employee details for ${leave.employee_id}:`, empError.message);
                    }

                    formattedLeaves.push({
                        id: leave.id,
                        employee_id: leave.employee_id,
                        leave_type: leave.leave_type,
                        leave_duration: leave.leave_duration,
                        start_date: leave.start_date,
                        end_date: leave.end_date,
                        half_day_type: leave.half_day_type,
                        reason: leave.reason,
                        reporting_manager: leave.reporting_manager,
                        status: leave.status,
                        applied_date: leave.applied_date,
                        days_count: leave.days_count,
                        admin_comments: leave.admin_comments,
                        created_at: leave.created_at,
                        updated_at: leave.updated_at,
                        first_name: employee?.first_name || '',
                        last_name: employee?.last_name || '',
                        department: employee?.department || '',
                        designation: employee?.designation || ''
                    });
                } else {
                    // For employee view, we don't need to fetch their own details again
                    formattedLeaves.push({
                        id: leave.id,
                        employee_id: leave.employee_id,
                        leave_type: leave.leave_type,
                        leave_duration: leave.leave_duration,
                        start_date: leave.start_date,
                        end_date: leave.end_date,
                        half_day_type: leave.half_day_type,
                        reason: leave.reason,
                        reporting_manager: leave.reporting_manager,
                        status: leave.status,
                        applied_date: leave.applied_date,
                        days_count: leave.days_count,
                        admin_comments: leave.admin_comments,
                        created_at: leave.created_at,
                        updated_at: leave.updated_at
                    });
                }
            } catch (empErr) {
                console.error(`❌ Error processing leave ${leave.id}:`, empErr);
                formattedLeaves.push(leave);
            }
        }

        res.json(formattedLeaves);

    } catch (error) {
        console.error('❌ Error in getLeaves:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching leaves',
            error: error.message
        });
    }
};

exports.updateLeaveStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, remarks } = req.body;
        const approver_id = req.user?.employeeId || req.body.approved_by;

        console.log('📝 Updating leave status:', { id, status, remarks, approver_id });

        if (!status || !['approved', 'rejected', 'cancelled'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Valid status (approved/rejected/cancelled) is required'
            });
        }

        // Get leave details first
        const { data: leave, error: fetchError } = await supabase
            .from('leaves')
            .select('*, employees!inner(first_name, last_name)')
            .eq('id', id)
            .single();

        if (fetchError) {
            console.error('❌ Error fetching leave:', fetchError);
            throw fetchError;
        }

        if (!leave) {
            return res.status(404).json({
                success: false,
                message: 'Leave request not found'
            });
        }

        console.log('📋 Found leave for employee:', leave.employee_id);

        // Update only this specific leave record
        const updateData = {
            status: status,
            remarks: remarks || null,
            updated_at: new Date().toISOString()
        };

        // Add approved_by if available
        if (approver_id) {
            updateData.approved_by = approver_id;
            updateData.approved_date = status === 'approved' ? new Date().toISOString().split('T')[0] : null;
        }

        console.log('📝 Updating with data:', updateData);

        // Update leave record
        const { data: updatedLeave, error: updateError } = await supabase
            .from('leaves')
            .update(updateData)
            .eq('id', id)
            .select();

        if (updateError) {
            console.error('❌ Error updating leave:', updateError);
            throw updateError;
        }

        console.log(`✅ Leave ${status} for employee ${leave.employee_id}:`, updatedLeave[0]);

        // If comp-off leave is approved, deduct from balance
        if (status === 'approved' && leave.leave_type === 'Comp-Off') {
            try {
                const { error: updateError } = await supabase
                    .from('employees')
                    .update({
                        comp_off_balance: supabase.raw('COALESCE(comp_off_balance, 0) - ?', [leave.days_count]),
                        total_comp_off_used: supabase.raw('COALESCE(total_comp_off_used, 0) + ?', [leave.days_count])
                    })
                    .eq('employee_id', leave.employee_id);

                if (updateError) {
                    console.error('Error updating comp-off balance:', updateError);
                } else {
                    console.log('✅ Comp-Off balance updated');
                }
            } catch (compErr) {
                console.error('Error in comp-off update:', compErr);
            }
        }

        res.json({
            success: true,
            message: `Leave request ${status} successfully`,
            leave: updatedLeave[0]
        });

    } catch (error) {
        console.error('❌ Error updating leave status:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            message: 'Failed to update leave status',
            error: error.message
        });
    }
};

// Get leave types
exports.getLeaveTypes = async (req, res) => {
    try {
        const { employee_id } = req.query;

        let availableTypes = [
            { value: 'Unpaid', label: 'Unpaid Leave', icon: '💰' }
        ];

        if (employee_id) {
            const { data: employee, error } = await supabase
                .from('employees')
                .select('comp_off_balance')
                .eq('employee_id', employee_id)
                .single();

            if (!error && employee.comp_off_balance > 0) {
                availableTypes.unshift({
                    value: 'Comp-Off',
                    label: `Comp-Off (${employee.comp_off_balance} days available)`,
                    icon: '🎉'
                });
            }

            const { data: empData } = await supabase
                .from('employees')
                .select('joining_date')
                .eq('employee_id', employee_id)
                .single();

            if (empData) {
                const joiningDate = new Date(empData.joining_date);
                const today = new Date();

                let monthsCompleted = (today.getFullYear() - joiningDate.getFullYear()) * 12;
                monthsCompleted += (today.getMonth() - joiningDate.getMonth());

                if (today.getDate() < joiningDate.getDate()) {
                    monthsCompleted -= 1;
                }

                monthsCompleted = Math.max(0, monthsCompleted);

                if (monthsCompleted >= 6) {
                    availableTypes.push(
                        { value: 'Annual', label: 'Annual Leave', icon: '🌴' },
                        { value: 'Sick', label: 'Sick Leave', icon: '🤒' },
                        { value: 'Personal', label: 'Personal Leave', icon: '👤' },
                        { value: 'Maternity', label: 'Maternity Leave', icon: '🤱' },
                        { value: 'Paternity', label: 'Paternity Leave', icon: '👨‍👧' },
                        { value: 'Bereavement', label: 'Bereavement Leave', icon: '💐' }
                    );
                }
            }
        }

        res.json({
            success: true,
            leaveTypes: availableTypes
        });

    } catch (error) {
        console.error('Error fetching leave types:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch leave types',
            error: error.message
        });
    }
};

// Manual accrual for testing
exports.manualAccrual = async (req, res) => {
    try {
        const { employee_id } = req.params;
        const result = await LeaveYearlyService.addMonthlyAccrual(employee_id);
        res.json(result);
    } catch (error) {
        console.error('Error in manual accrual:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add manual accrual',
            error: error.message
        });
    }
};

// Yearly reset (admin only)
exports.yearlyReset = async (req, res) => {
    try {
        const result = await LeaveYearlyService.resetAllForNewYear();
        res.json(result);
    } catch (error) {
        console.error('Error in yearly reset:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reset yearly leaves',
            error: error.message
        });
    }
};

module.exports = exports;