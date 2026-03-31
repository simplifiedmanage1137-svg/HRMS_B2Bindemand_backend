// controllers/notificationController.js
const supabase = require('../config/supabase');

// Get notifications for employee
exports.getNotifications = async (req, res) => {
    try {
        const employee_id = req.employeeId; // from token
        
        const { data: notifications, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('employee_id', employee_id)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;
        
        res.json(notifications || []);
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching notifications',
            error: error.message 
        });
    }
};

// Get unread count
exports.getUnreadCount = async (req, res) => {
    try {
        const employee_id = req.employeeId;
        
        const { count, error } = await supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('employee_id', employee_id)
            .eq('is_read', false);

        if (error) throw error;

        res.json({ 
            success: true, 
            count: count || 0 
        });
    } catch (error) {
        console.error('Error getting unread count:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error getting unread count',
            error: error.message 
        });
    }
};

// Mark notification as read
exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        
        const { data, error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('id', id)
            .select();

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Notification not found' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Notification marked as read' 
        });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error marking notification as read',
            error: error.message 
        });
    }
};

// Mark all notifications as read
exports.markAllAsRead = async (req, res) => {
    try {
        const employee_id = req.employeeId;
        
        const { data, error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('employee_id', employee_id)
            .eq('is_read', false)
            .select();

        if (error) throw error;

        res.json({ 
            success: true, 
            message: 'All notifications marked as read',
            count: data?.length || 0
        });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error marking all notifications as read',
            error: error.message 
        });
    }
};

// Delete notification
exports.deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;
        
        const { data, error } = await supabase
            .from('notifications')
            .delete()
            .eq('id', id)
            .select();

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Notification not found' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Notification deleted successfully' 
        });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error deleting notification',
            error: error.message 
        });
    }
};

// Delete all read notifications
exports.deleteReadNotifications = async (req, res) => {
    try {
        const { employee_id } = req.params;
        
        if (!employee_id) {
            return res.status(400).json({ 
                success: false, 
                message: 'Employee ID is required' 
            });
        }

        const { data, error } = await supabase
            .from('notifications')
            .delete()
            .eq('employee_id', employee_id)
            .eq('is_read', true)
            .select();

        if (error) throw error;

        res.json({ 
            success: true, 
            message: 'Read notifications deleted successfully',
            count: data?.length || 0
        });
    } catch (error) {
        console.error('Error deleting read notifications:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error deleting read notifications',
            error: error.message 
        });
    }
};

// Get notification by ID
exports.getNotificationById = async (req, res) => {
    try {
        const { id } = req.params;
        
        const { data: notification, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Notification not found' 
                });
            }
            throw error;
        }

        res.json({ 
            success: true, 
            notification 
        });
    } catch (error) {
        console.error('Error fetching notification:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching notification',
            error: error.message 
        });
    }
};