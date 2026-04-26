const supabase = require('../config/supabase');

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

        // Approved leaves - split by type
        const { data: usedLeaves, error: usedError } = await supabase
            .from('leaves')
            .select('days_count, leave_type')
            .eq('employee_id', employee_id)
            .eq('status', 'approved')
            .gte('start_date', `${currentYear}-01-01`)
            .lte('start_date', `${currentYear}-12-31`);
        if (usedError) throw usedError;

        // Paid leaves used (excludes Unpaid & Comp-Off)
        const used = usedLeaves
            ?.filter(l => l.leave_type !== 'Unpaid' && l.leave_type !== 'Comp-Off')
            ?.reduce((sum, l) => sum + (parseFloat(l.days_count) || 0), 0) || 0;

        // Unpaid leaves used separately
        const unpaidUsed = usedLeaves
            ?.filter(l => l.leave_type === 'Unpaid')
            ?.reduce((sum, l) => sum + (parseFloat(l.days_count) || 0), 0) || 0;

        // Pending paid leaves
        const { data: pendingLeaves, error: pendingError } = await supabase
            .from('leaves')
            .select('days_count, leave_type')
            .eq('employee_id', employee_id)
            .eq('status', 'pending')
            .gte('start_date', `${currentYear}-01-01`)
            .lte('start_date', `${currentYear}-12-31`);
        if (pendingError) throw pendingError;

        const pending = pendingLeaves
            ?.filter(l => l.leave_type !== 'Unpaid' && l.leave_type !== 'Comp-Off')
            ?.reduce((sum, l) => sum + (parseFloat(l.days_count) || 0), 0) || 0;

        const unpaidPending = pendingLeaves
            ?.filter(l => l.leave_type === 'Unpaid')
            ?.reduce((sum, l) => sum + (parseFloat(l.days_count) || 0), 0) || 0;

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
            unpaid_used: unpaidUsed.toFixed(1),
            unpaid_pending: unpaidPending.toFixed(1),
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
        const {
            employee_id, leave_type, leave_duration, half_day_type,
            start_date, end_date, reason, days_count, reporting_manager
        } = req.body;

        if (!employee_id || !leave_type || !start_date || !reason) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        if (!reporting_manager || !reporting_manager.trim()) {
            return res.status(400).json({ success: false, message: 'Reporting manager is required' });
        }

        const { data: employee, error: empError } = await supabase
            .from('employees').select('joining_date, comp_off_balance, first_name, last_name')
            .eq('employee_id', employee_id).single();
        if (empError) throw empError;

        const joiningDate = new Date(employee.joining_date);
        const today = new Date();
        let totalMonths = (today.getFullYear() - joiningDate.getFullYear()) * 12 +
                          (today.getMonth() - joiningDate.getMonth());
        if (today.getDate() < joiningDate.getDate()) totalMonths = Math.max(0, totalMonths - 1);
        const isProbComplete = totalMonths >= 6;

        if (!isProbComplete && leave_type !== 'Unpaid' && leave_type !== 'Comp-Off') {
            return res.status(400).json({
                success: false,
                message: `During probation (${totalMonths}/6 months), only Unpaid or Comp-Off leave allowed.`
            });
        }

        if (isProbComplete && leave_type !== 'Unpaid' && leave_type !== 'Comp-Off') {
            const { data: balanceData } = await supabase
                .from('leave_balance').select('current_balance')
                .eq('employee_id', employee_id).eq('leave_year', today.getFullYear()).maybeSingle();
            const available = balanceData?.current_balance || 0;
            if (available < days_count) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient leave balance. Available: ${available.toFixed(1)} days.`
                });
            }
        }

        if (leave_type === 'Comp-Off' && (employee.comp_off_balance || 0) < days_count) {
            return res.status(400).json({
                success: false,
                message: `Insufficient Comp-Off balance. Available: ${employee.comp_off_balance || 0} days`
            });
        }

        // IST timestamp for created_at
        const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
        const nowUTC = new Date();
        const istMs = nowUTC.getTime() + IST_OFFSET_MS;
        const istDate = new Date(istMs);
        const createdAtIST = `${istDate.getUTCFullYear()}-${String(istDate.getUTCMonth()+1).padStart(2,'0')}-${String(istDate.getUTCDate()).padStart(2,'0')} ${String(istDate.getUTCHours()).padStart(2,'0')}:${String(istDate.getUTCMinutes()).padStart(2,'0')}:${String(istDate.getUTCSeconds()).padStart(2,'0')}`;

        const { data: leaveData, error: leaveError } = await supabase
            .from('leaves')
            .insert([{
                employee_id,
                employee_name: `${employee.first_name} ${employee.last_name}`,
                leave_type, leave_duration,
                half_day_type: half_day_type || null,
                start_date,
                end_date: end_date || start_date,
                reason,
                days_count: days_count || 1,
                reporting_manager: reporting_manager.trim(),
                status: 'pending',
                applied_date: nowUTC.toISOString().split('T')[0],
                created_at: createdAtIST,
                updated_at: createdAtIST
            }])
            .select();

        if (leaveError) {
            // If employee_name column doesn't exist, retry without it
            if (leaveError.message && leaveError.message.includes('employee_name')) {
                const { data: leaveData2, error: leaveError2 } = await supabase
                    .from('leaves')
                    .insert([{
                        employee_id, leave_type, leave_duration,
                        half_day_type: half_day_type || null,
                        start_date, end_date: end_date || start_date,
                        reason, days_count: days_count || 1,
                        reporting_manager: reporting_manager.trim(),
                        status: 'pending',
                        applied_date: nowUTC.toISOString().split('T')[0],
                        created_at: createdAtIST, updated_at: createdAtIST
                    }])
                    .select();
                if (leaveError2) throw leaveError2;
                return res.json({ success: true, message: 'Leave request submitted successfully!', leave: leaveData2[0] });
            }
            throw leaveError;
        }

        res.json({ success: true, message: 'Leave request submitted successfully!', leave: leaveData[0] });

    } catch (error) {
        console.error('❌ Error applying leave:', error);
        res.status(500).json({ success: false, message: 'Failed to apply leave', error: error.message });
    }
};

// ==================== GET ALL LEAVES ====================
exports.getLeaves = async (req, res) => {
    try {
        const authenticatedUserId = req.user?.employeeId;
        const userRole = req.user?.role;

        let query = supabase
            .from('leaves')
            .select('*, employees!inner(first_name, last_name, department, designation)');

        const isAdmin = userRole === 'admin' && req.query.all === 'true';
        const isReportingManager = req.query.reporting_manager === 'true';

        if (isAdmin) {
            // Admin: all leaves, only view (no approve/reject from here)
            if (req.query.employee_id) query = query.eq('employee_id', req.query.employee_id);
        } else if (isReportingManager) {
            // Reporting manager: leaves where reporting_manager matches OR
            // employee's reporting_manager in employees table matches (for old leaves with null reporting_manager)
            const { data: emp } = await supabase
                .from('employees').select('first_name, last_name')
                .eq('employee_id', authenticatedUserId).single();
            const managerName = emp ? `${emp.first_name} ${emp.last_name}` : '';

            // Get all employee_ids who report to this manager
            const { data: teamEmps } = await supabase
                .from('employees')
                .select('employee_id')
                .eq('reporting_manager', managerName);
            const teamIds = (teamEmps || []).map(e => e.employee_id);

            if (teamIds.length === 0) {
                return res.json([]);
            }

            // Fetch leaves where employee is in team (covers both null and set reporting_manager)
            query = query.in('employee_id', teamIds);
        } else {
            // Employee: own leaves only
            if (!authenticatedUserId) return res.json([]);
            query = query.eq('employee_id', authenticatedUserId);
        }

        query = query.order('created_at', { ascending: false });
        const { data: leaves, error } = await query;
        if (error) throw error;

        const formatted = (leaves || []).map(l => ({
            ...l,
            first_name: l.employees?.first_name || l.employee_name?.split(' ')[0] || '',
            last_name: l.employees?.last_name || l.employee_name?.split(' ').slice(1).join(' ') || '',
            department: l.employees?.department || '',
            designation: l.employees?.designation || '',
            employees: undefined
        }));

        res.json(formatted);
    } catch (error) {
        console.error('❌ Error in getLeaves:', error);
        res.status(500).json({ success: false, message: 'Error fetching leaves', error: error.message });
    }
};

// ==================== UPDATE LEAVE STATUS ====================
exports.updateLeaveStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, remarks } = req.body;
        const approver_id = req.user?.employeeId;
        const userRole = req.user?.role;

        if (!status || !['approved', 'rejected', 'cancelled'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Valid status required' });
        }

        const { data: leave, error: fetchError } = await supabase
            .from('leaves').select('*').eq('id', id).single();
        if (fetchError || !leave) {
            return res.status(404).json({ success: false, message: 'Leave request not found' });
        }

        // Only reporting manager can approve/reject (not admin)
        if (userRole !== 'admin' && status !== 'cancelled') {
            const { data: approver } = await supabase
                .from('employees').select('first_name, last_name')
                .eq('employee_id', approver_id).single();
            const approverName = approver ? `${approver.first_name} ${approver.last_name}` : '';
            if (leave.reporting_manager !== approverName) {
                return res.status(403).json({
                    success: false,
                    message: 'Only the assigned reporting manager can approve or reject this leave'
                });
            }
        }

        const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
        const nowIST = new Date(Date.now() + IST_OFFSET_MS);
        const updatedAtIST = `${nowIST.getUTCFullYear()}-${String(nowIST.getUTCMonth()+1).padStart(2,'0')}-${String(nowIST.getUTCDate()).padStart(2,'0')} ${String(nowIST.getUTCHours()).padStart(2,'0')}:${String(nowIST.getUTCMinutes()).padStart(2,'0')}:${String(nowIST.getUTCSeconds()).padStart(2,'0')}`;

        const updateData = {
            status,
            remarks: remarks || null,
            updated_at: updatedAtIST,
            approved_by: approver_id || null,
            approved_date: status === 'approved' ? new Date().toISOString().split('T')[0] : null
        };

        const { data: updatedLeave, error: updateError } = await supabase
            .from('leaves').update(updateData).eq('id', id).select();
        if (updateError) throw updateError;

        // On approval: immediately deduct from leave balance
        if (status === 'approved') {
            const today = new Date();
            const leaveYear = today.getFullYear();

            if (leave.leave_type === 'Comp-Off') {
                // Deduct from comp_off_balance
                const { data: emp } = await supabase
                    .from('employees').select('comp_off_balance').eq('employee_id', leave.employee_id).single();
                const newBalance = Math.max(0, (emp?.comp_off_balance || 0) - (leave.days_count || 1));
                await supabase.from('employees')
                    .update({ comp_off_balance: newBalance })
                    .eq('employee_id', leave.employee_id);
            } else if (leave.leave_type !== 'Unpaid') {
                // Deduct from leave_balance
                const { data: bal } = await supabase
                    .from('leave_balance').select('*')
                    .eq('employee_id', leave.employee_id).eq('leave_year', leaveYear).maybeSingle();
                if (bal) {
                    const newUsed = (bal.total_used || 0) + (leave.days_count || 1);
                    const newBalance = Math.max(0, (bal.total_accrued || 0) - newUsed - (bal.total_pending || 0));
                    await supabase.from('leave_balance').update({
                        total_used: newUsed,
                        current_balance: newBalance,
                        last_updated: new Date().toISOString()
                    }).eq('employee_id', leave.employee_id).eq('leave_year', leaveYear);
                }
            }
        }

        res.json({ success: true, message: `Leave ${status} successfully`, leave: updatedLeave[0] });

    } catch (error) {
        console.error('❌ Error updating leave status:', error);
        res.status(500).json({ success: false, message: 'Failed to update leave status', error: error.message });
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