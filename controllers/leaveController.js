// controllers/leaveController.js - COMPLETE WORKING VERSION

const supabase = require('../config/supabase');

// ==================== LOCAL HELPER FUNCTIONS ====================

// Replace the getCompletedMonthsInCurrentYear function with this simplified version:

function getCompletedMonthsInCurrentYear(joiningDate, currentDate = new Date()) {
    const today = new Date(currentDate);
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth(); // 0-11 (April = 3)
    const join = new Date(joiningDate);
    
    if (join.getFullYear() > currentYear) {
        return 0;
    }
    
    let completedMonths = 0;
    
    if (join.getFullYear() === currentYear) {
        // Joined this year
        const joinMonth = join.getMonth();
        // Count months from joining month to previous month
        for (let month = joinMonth; month < currentMonth; month++) {
            completedMonths++;
        }
    } else {
        // Joined previous year or earlier
        // Count months from January to previous month
        for (let month = 0; month < currentMonth; month++) {
            completedMonths++;
        }
    }
    
    return Math.max(0, completedMonths);
}

function calculateCurrentYearAccruedLeaves(joiningDate, currentDate = new Date()) {
    const completedMonths = getCompletedMonthsInCurrentYear(joiningDate, currentDate);
    return completedMonths * 1.5;
}

function getTotalMonthsFromJoining(joiningDate, currentDate = new Date()) {
    const join = new Date(joiningDate);
    const today = new Date(currentDate);
    
    if (today < join) return 0;
    
    let totalMonths = (today.getFullYear() - join.getFullYear()) * 12 + 
                      (today.getMonth() - join.getMonth());
    
    if (today.getDate() < join.getDate()) {
        totalMonths = Math.max(0, totalMonths - 1);
    }
    
    return totalMonths;
}

function isProbationComplete(joiningDate, currentDate = new Date()) {
    const totalMonths = getTotalMonthsFromJoining(joiningDate, currentDate);
    return totalMonths >= 6;
}

function getEligibleFromDate(joiningDate) {
    const eligibleDate = new Date(joiningDate);
    eligibleDate.setMonth(eligibleDate.getMonth() + 6);
    return eligibleDate.toISOString().split('T')[0];
}

// ==================== GET LEAVE BALANCE ====================
exports.getLeaveBalance = async (req, res) => {
    try {
        const { employee_id } = req.params;

        console.log('📊 Fetching leave balance for employee:', employee_id);

        const { data: employee, error: empError } = await supabase
            .from('employees')
            .select('joining_date, comp_off_balance')
            .eq('employee_id', employee_id)
            .single();

        if (empError) throw empError;

        const joiningDate = new Date(employee.joining_date);
        const today = new Date();
        const currentYear = today.getFullYear();

        const currentYearAccrual = calculateCurrentYearAccruedLeaves(joiningDate, today);
        const totalMonthsFromJoining = getTotalMonthsFromJoining(joiningDate, today);
        const isProbComplete = isProbationComplete(joiningDate, today);
        const eligibleFromDateStr = getEligibleFromDate(joiningDate);
        const completedMonths = getCompletedMonthsInCurrentYear(joiningDate, today);

        console.log('📊 Leave Calculation:', {
            employee_id,
            joining_date: employee.joining_date,
            current_year: currentYear,
            completed_months_in_current_year: completedMonths,
            current_year_accrual: currentYearAccrual,
            total_months_from_joining: totalMonthsFromJoining,
            is_probation_complete: isProbComplete
        });

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

        let available = 0;
        if (isProbComplete) {
            available = Math.max(0, currentYearAccrual - used - pending);
        }

        await supabase
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

        res.json({
            success: true,
            total_accrued: currentYearAccrual.toFixed(1),
            used: used.toFixed(1),
            pending: pending.toFixed(1),
            available: available.toFixed(1),
            comp_off_balance: (employee.comp_off_balance || 0).toFixed(1),
            months_completed_in_year: completedMonths,
            total_months_from_joining: totalMonthsFromJoining,
            is_probation_complete: isProbComplete,
            is_eligible: isProbComplete,
            eligible_from_date: eligibleFromDateStr,
            leave_year: currentYear,
            joining_date: employee.joining_date,
            next_accrual_date: new Date(currentYear, today.getMonth() + 1, 0).toISOString().split('T')[0],
            probation_info: {
                is_active: !isProbComplete,
                months_completed: totalMonthsFromJoining,
                months_remaining: Math.max(0, 6 - totalMonthsFromJoining),
                eligible_from_date: eligibleFromDateStr,
                accrued_but_unusable: !isProbComplete ? currentYearAccrual : 0
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

// ==================== APPLY LEAVE ====================
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

        if (!employee_id || !leave_type || !start_date || !reason) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        const { data: employee, error: empError } = await supabase
            .from('employees')
            .select('joining_date, comp_off_balance')
            .eq('employee_id', employee_id)
            .single();

        if (empError) throw empError;

        const joiningDate = new Date(employee.joining_date);
        const today = new Date();
        
        let totalMonths = (today.getFullYear() - joiningDate.getFullYear()) * 12 + 
                          (today.getMonth() - joiningDate.getMonth());
        if (today.getDate() < joiningDate.getDate()) {
            totalMonths = Math.max(0, totalMonths - 1);
        }
        const isProbComplete = totalMonths >= 6;

        console.log('📊 Probation check:', {
            joining_date: employee.joining_date,
            total_months: totalMonths,
            isProbationComplete: isProbComplete
        });

        if (!isProbComplete) {
            if (leave_type !== 'Unpaid' && leave_type !== 'Comp-Off') {
                return res.status(400).json({
                    success: false,
                    message: `During probation period (${totalMonths}/6 months completed), you can only apply for Unpaid Leave or Comp-Off.`
                });
            }
        }

        if (isProbComplete && leave_type !== 'Unpaid' && leave_type !== 'Comp-Off') {
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
                    message: `Insufficient leave balance. Available: ${available.toFixed(1)} days.`
                });
            }
        }

        if (leave_type === 'Comp-Off') {
            if ((employee.comp_off_balance || 0) < days_count) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient Comp-Off balance. Available: ${employee.comp_off_balance || 0} days`
                });
            }
        }

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
                error: leaveError.message
            });
        }

        console.log('✅ Leave applied successfully:', leaveData[0]);

        res.json({
            success: true,
            message: 'Leave request submitted successfully!',
            leave: leaveData[0]
        });

    } catch (error) {
        console.error('❌ Error applying leave:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to apply leave',
            error: error.message
        });
    }
};

// ==================== GET ALL LEAVES ====================
exports.getLeaves = async (req, res) => {
    try {
        const authenticatedUserId = req.user?.employeeId;
        const userRole = req.user?.role;

        let query = supabase.from('leaves').select('*');

        if (!(userRole === 'admin' && req.query.all === 'true')) {
            if (!authenticatedUserId) {
                return res.json([]);
            }
            query = query.eq('employee_id', authenticatedUserId);
        } else if (req.query.employee_id) {
            query = query.eq('employee_id', req.query.employee_id);
        }

        query = query.order('applied_date', { ascending: false });

        const { data: leaves, error } = await query;

        if (error) throw error;

        res.json(leaves || []);

    } catch (error) {
        console.error('❌ Error in getLeaves:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching leaves',
            error: error.message
        });
    }
};

// ==================== UPDATE LEAVE STATUS ====================
exports.updateLeaveStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, remarks } = req.body;
        const approver_id = req.user?.employeeId || req.body.approved_by;

        if (!status || !['approved', 'rejected', 'cancelled'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Valid status (approved/rejected/cancelled) is required'
            });
        }

        const { data: leave, error: fetchError } = await supabase
            .from('leaves')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !leave) {
            return res.status(404).json({
                success: false,
                message: 'Leave request not found'
            });
        }

        const updateData = {
            status: status,
            remarks: remarks || null,
            updated_at: new Date().toISOString()
        };

        if (approver_id) {
            updateData.approved_by = approver_id;
            updateData.approved_date = status === 'approved' ? new Date().toISOString().split('T')[0] : null;
        }

        const { data: updatedLeave, error: updateError } = await supabase
            .from('leaves')
            .update(updateData)
            .eq('id', id)
            .select();

        if (updateError) throw updateError;

        if (status === 'approved' && leave.leave_type === 'Comp-Off') {
            await supabase
                .from('employees')
                .update({
                    comp_off_balance: supabase.raw('COALESCE(comp_off_balance, 0) - ?', [leave.days_count])
                })
                .eq('employee_id', leave.employee_id);
        }

        res.json({
            success: true,
            message: `Leave request ${status} successfully`,
            leave: updatedLeave[0]
        });

    } catch (error) {
        console.error('❌ Error updating leave status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update leave status',
            error: error.message
        });
    }
};

// ==================== GET LEAVE TYPES ====================
exports.getLeaveTypes = async (req, res) => {
    try {
        const { employee_id } = req.query;

        let availableTypes = [
            { value: 'Unpaid', label: 'Unpaid Leave', icon: '💰' }
        ];

        if (employee_id) {
            const { data: employee, error } = await supabase
                .from('employees')
                .select('comp_off_balance, joining_date')
                .eq('employee_id', employee_id)
                .single();

            if (!error && employee) {
                if (employee.comp_off_balance > 0) {
                    availableTypes.unshift({
                        value: 'Comp-Off',
                        label: `Comp-Off (${employee.comp_off_balance} days available)`,
                        icon: '🎉'
                    });
                }

                if (employee.joining_date) {
                    const joiningDate = new Date(employee.joining_date);
                    const today = new Date();
                    
                    let totalMonths = (today.getFullYear() - joiningDate.getFullYear()) * 12 + 
                                      (today.getMonth() - joiningDate.getMonth());
                    if (today.getDate() < joiningDate.getDate()) {
                        totalMonths = Math.max(0, totalMonths - 1);
                    }

                    if (totalMonths >= 6) {
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

// ==================== MANUAL ACCRUAL ====================
exports.manualAccrual = async (req, res) => {
    try {
        const { employee_id } = req.params;
        
        const { data: employee, error: empError } = await supabase
            .from('employees')
            .select('joining_date')
            .eq('employee_id', employee_id)
            .single();
            
        if (empError) throw empError;
        
        const joiningDate = new Date(employee.joining_date);
        const today = new Date();
        const currentYearAccrual = calculateCurrentYearAccruedLeaves(joiningDate, today);
        const currentYear = today.getFullYear();
        
        const { data: existingBalance } = await supabase
            .from('leave_balance')
            .select('*')
            .eq('employee_id', employee_id)
            .eq('leave_year', currentYear)
            .single();
            
        if (existingBalance) {
            await supabase
                .from('leave_balance')
                .update({
                    total_accrued: currentYearAccrual,
                    current_balance: currentYearAccrual - (existingBalance.total_used || 0),
                    last_updated: today.toISOString()
                })
                .eq('employee_id', employee_id)
                .eq('leave_year', currentYear);
        } else {
            await supabase
                .from('leave_balance')
                .insert([{
                    employee_id,
                    leave_year: currentYear,
                    total_accrued: currentYearAccrual,
                    total_used: 0,
                    total_pending: 0,
                    current_balance: currentYearAccrual,
                    last_updated: today.toISOString()
                }]);
        }
        
        res.json({
            success: true,
            message: `Manual accrual updated: ${currentYearAccrual} days`,
            total_accrued: currentYearAccrual,
            completed_months: getCompletedMonthsInCurrentYear(joiningDate, today)
        });
        
    } catch (error) {
        console.error('Error in manual accrual:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add manual accrual',
            error: error.message
        });
    }
};

// ==================== YEARLY RESET ====================
exports.yearlyReset = async (req, res) => {
    try {
        const nextYear = new Date().getFullYear() + 1;
        
        const { data: employees } = await supabase
            .from('employees')
            .select('employee_id, joining_date');
            
        if (employees) {
            for (const emp of employees) {
                const joiningDate = new Date(emp.joining_date);
                const today = new Date(nextYear, 0, 1);
                
                let accruedMonths = 0;
                const joinYear = joiningDate.getFullYear();
                
                if (joinYear <= nextYear) {
                    for (let month = 0; month < 12; month++) {
                        accruedMonths++;
                    }
                }
                
                const accrualAmount = accruedMonths * 1.5;
                
                const { data: existing } = await supabase
                    .from('leave_balance')
                    .select('id')
                    .eq('employee_id', emp.employee_id)
                    .eq('leave_year', nextYear)
                    .single();
                    
                if (!existing) {
                    await supabase
                        .from('leave_balance')
                        .insert([{
                            employee_id: emp.employee_id,
                            leave_year: nextYear,
                            total_accrued: accrualAmount,
                            total_used: 0,
                            total_pending: 0,
                            current_balance: accrualAmount,
                            last_updated: new Date().toISOString()
                        }]);
                }
            }
        }
        
        res.json({
            success: true,
            message: `Yearly reset completed for ${nextYear}`,
            year: nextYear
        });
        
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