// routes/leaveRoutes.js - Simplified version
const express = require('express');
const router = express.Router();
const leaveController = require('../controllers/leaveController');

// Get leave types
router.get('/types', leaveController.getLeaveTypes);

// Get leave balance for employee
router.get('/balance/:employee_id', leaveController.getLeaveBalance);

// Get all leaves (admin gets all, employee gets their own)
router.get('/', leaveController.getLeaves);

// Apply for leave
router.post('/apply', leaveController.applyLeave);

// Update leave status (admin only)
router.put('/:id/status', leaveController.updateLeaveStatus);

// Manual accrual (for testing)
router.post('/manual-accrual/:employee_id', leaveController.manualAccrual);

// Yearly reset (admin only)
router.post('/yearly-reset', leaveController.yearlyReset);

console.log('✅ Leave routes loaded');

module.exports = router;