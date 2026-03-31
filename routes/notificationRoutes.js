const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { verifyToken } = require('../middleware/auth');

// All notification routes require authentication
router.use(verifyToken);

// Get notifications for employee
router.get('/', notificationController.getNotifications);

// Get unread count
router.get('/unread', notificationController.getUnreadCount);

// Mark notification as read
router.put('/:id/read', notificationController.markAsRead);

// Mark all notifications as read
router.put('/mark-all-read', notificationController.markAllAsRead);

// Delete notification
router.delete('/:id', notificationController.deleteNotification);

// Delete all read notifications
router.delete('/read/all/:employee_id', notificationController.deleteReadNotifications);

// Get notification by ID
router.get('/:id', notificationController.getNotificationById);

console.log('✅ Notification routes loaded');
module.exports = router;