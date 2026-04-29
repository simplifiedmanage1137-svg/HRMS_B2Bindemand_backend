const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');

// Note: This module exports a function that takes supabase, authenticateToken, and requireAdmin
module.exports = (supabase, authenticateToken, requireAdmin) => {
    
    // Clock in/out endpoints
    router.post('/clock-in', attendanceController.clockIn);
    router.post('/clock-out', attendanceController.clockOut);
    router.post('/heartbeat', attendanceController.heartbeat);

    // Get today's attendance for an employee
    router.get('/today/:employee_id', attendanceController.getTodayAttendance);

    // Employee self-service attendance report
    router.get('/employee-report/:employee_id', authenticateToken, attendanceController.getEmployeeAttendanceReport);

    // Regularization endpoints (Employee)
    router.get('/missed-clockouts/:employee_id', attendanceController.getMissedClockOuts);
    router.post('/regularization/:employee_id/request', attendanceController.requestRegularization);

    // Admin-only attendance report (full access)
    router.get('/report', authenticateToken, requireAdmin, attendanceController.getAttendanceReport);

    // Regularization endpoints
    // Managers and admins can view and act on regularization requests according to team-level approval rules.
    router.get('/regularization/pending', authenticateToken, attendanceController.getPendingRegularizations);
    router.put('/regularization/:request_id/approve', authenticateToken, attendanceController.approveRegularization);
    router.put('/regularization/:request_id/reject', authenticateToken, attendanceController.rejectRegularization);

    // Overtime endpoints (Admin or own data)
    router.get('/overtime/:employee_id/:month/:year', authenticateToken, attendanceController.getOvertimeSummary);

    // Comp-off endpoints (Admin only)
    router.get('/comp-off/:employee_id', authenticateToken, requireAdmin, attendanceController.getCompOffBalance);
    router.get('/comp-off/:employee_id/history', authenticateToken, requireAdmin, attendanceController.getCompOffHistory);

    // Auto-close stale sessions (Admin only)
    router.post('/auto-close-stale', authenticateToken, requireAdmin, async (req, res) => {
        const result = await attendanceController.autoCloseStaleSessions();
        res.json(result);
    });

    // Update historical late marks (Admin only)
    router.post('/update-historical-late-marks', authenticateToken, requireAdmin, attendanceController.updateHistoricalLateMarks);

    // Mark absent employees as leave (Admin only)
    router.post('/mark-absent-as-leave', authenticateToken, requireAdmin, attendanceController.markAbsentEmployeesAsLeave);

    // Dashboard stats (Admin only)
    router.get('/dashboard-stats', authenticateToken, requireAdmin, async (req, res) => {
        try {
            const today = new Date().toISOString().split('T')[0];

            // Get total employees count
            const { count: totalEmployees, error: totalError } = await supabase
                .from('employees')
                .select('*', { count: 'exact', head: true });

            if (totalError) throw totalError;

            // Get today's attendance stats
            const { data: todayAttendance, error: attendanceError } = await supabase
                .from('attendance')
                .select('status, employee_id, late_minutes')
                .eq('attendance_date', today);

            if (attendanceError) throw attendanceError;

            const presentToday = todayAttendance?.filter(a => a.status === 'present').length || 0;
            const halfDayToday = todayAttendance?.filter(a => a.status === 'half_day').length || 0;
            const absentToday = todayAttendance?.filter(a => a.status === 'absent').length || 0;
            const lateToday = todayAttendance?.filter(a => a.late_minutes > 0).length || 0;

            // Get pending update requests
            const { count: pendingRequests, error: updateError } = await supabase
                .from('update_requests')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending');

            if (updateError) throw updateError;

            // Get pending regularization requests
            const { count: pendingRegularizations, error: regError } = await supabase
                .from('regularization_requests')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending');

            if (regError) throw regError;

            // Get pending leave requests
            const { count: pendingLeaveRequests, error: leaveError } = await supabase
                .from('leave_requests')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending');

            if (leaveError) throw leaveError;

            // Get employees on leave today
            const { count: onLeave, error: onLeaveError } = await supabase
                .from('leave_requests')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'approved')
                .lte('start_date', today)
                .gte('end_date', today);

            if (onLeaveError) throw onLeaveError;

            res.json({
                success: true,
                stats: {
                    totalEmployees: totalEmployees || 0,
                    presentToday: presentToday + halfDayToday,
                    absentToday: absentToday,
                    onLeave: onLeave || 0,
                    pendingRequests: pendingRequests || 0,
                    pendingRegularizations: pendingRegularizations || 0,
                    pendingLeaveRequests: pendingLeaveRequests || 0,
                    lateToday: lateToday
                }
            });

        } catch (error) {
            console.error('Error fetching dashboard stats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch dashboard stats',
                error: error.message
            });
        }
    });

    console.log('✅ Attendance routes loaded with regularization support');
    return router;
};