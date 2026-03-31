// services/notificationService.js
const supabase = require('../config/supabase');

class NotificationService {
    
    // Create a new notification
    async createNotification({ employee_id, title, message, type, reference_id = null, metadata = null }) {
        try {
            if (!employee_id) {
                console.warn('⚠️ Notification skipped: No employee_id provided');
                return null;
            }

            const notification = {
                employee_id,
                title: title || 'Notification',
                message,
                type: type || 'info',
                reference_id,
                metadata,
                is_read: false,
                created_at: new Date().toISOString()
            };

            const { data, error } = await supabase
                .from('notifications')
                .insert([notification])
                .select();

            if (error) throw error;

            console.log(`✅ Notification created for ${employee_id}: ${title}`);
            return data[0];

        } catch (error) {
            console.error('❌ Error creating notification:', error);
            return null;
        }
    }

    // Create notifications for multiple employees
    async createBulkNotifications(notifications) {
        try {
            const validNotifications = notifications.filter(n => n.employee_id);
            
            if (validNotifications.length === 0) {
                return [];
            }

            const notificationsToInsert = validNotifications.map(n => ({
                employee_id: n.employee_id,
                title: n.title || 'Notification',
                message: n.message,
                type: n.type || 'info',
                reference_id: n.reference_id || null,
                metadata: n.metadata || null,
                is_read: false,
                created_at: new Date().toISOString()
            }));

            const { data, error } = await supabase
                .from('notifications')
                .insert(notificationsToInsert)
                .select();

            if (error) throw error;

            console.log(`✅ Created ${data.length} bulk notifications`);
            return data;

        } catch (error) {
            console.error('❌ Error creating bulk notifications:', error);
            return [];
        }
    }

    // Send leave approval notifications
    async sendLeaveApprovalNotifications(leave, approverType, status, comments = null) {
        try {
            const notifications = [];

            // Get employee details
            const { data: employee } = await supabase
                .from('employees')
                .select('first_name, last_name, reporting_manager')
                .eq('employee_id', leave.employee_id)
                .single();

            if (!employee) return;

            const employeeName = `${employee.first_name} ${employee.last_name}`;

            // Notification to employee
            if (status === 'approved') {
                notifications.push({
                    employee_id: leave.employee_id,
                    title: approverType === 'rm' ? 'RM Approved' : 'Leave Approved',
                    message: approverType === 'rm' 
                        ? `Your leave request has been approved by your Reporting Manager and is now pending HR approval.`
                        : `Your leave request has been fully approved!`,
                    type: 'leave_approved',
                    reference_id: leave.id,
                    metadata: { leave_id: leave.id, approver_type: approverType, status }
                });
            } else if (status === 'rejected') {
                notifications.push({
                    employee_id: leave.employee_id,
                    title: 'Leave Rejected',
                    message: `Your leave request has been rejected by ${approverType === 'rm' ? 'Reporting Manager' : 'HR'}.${comments ? ' Reason: ' + comments : ''}`,
                    type: 'leave_rejected',
                    reference_id: leave.id,
                    metadata: { leave_id: leave.id, approver_type: approverType, comments }
                });
            }

            // If RM approves, notify HR
            if (approverType === 'rm' && status === 'approved') {
                const { data: hrUsers } = await supabase
                    .from('users')
                    .select('employee_id')
                    .eq('role', 'admin');

                for (const hr of hrUsers || []) {
                    notifications.push({
                        employee_id: hr.employee_id,
                        title: 'Leave Pending HR Approval',
                        message: `${employeeName}'s leave request has been approved by RM and now requires your approval.`,
                        type: 'leave_pending_hr',
                        reference_id: leave.id,
                        metadata: { leave_id: leave.id, employee_name: employeeName }
                    });
                }
            }

            // If rejected, notify HR as well
            if (status === 'rejected') {
                const { data: hrUsers } = await supabase
                    .from('users')
                    .select('employee_id')
                    .eq('role', 'admin');

                for (const hr of hrUsers || []) {
                    notifications.push({
                        employee_id: hr.employee_id,
                        title: 'Leave Request Rejected',
                        message: `${employeeName}'s leave request has been rejected by ${approverType === 'rm' ? 'Reporting Manager' : 'HR'}.`,
                        type: 'leave_rejected_notification',
                        reference_id: leave.id,
                        metadata: { leave_id: leave.id, rejected_by: approverType, comments }
                    });
                }
            }

            return await this.createBulkNotifications(notifications);

        } catch (error) {
            console.error('❌ Error sending leave approval notifications:', error);
            return [];
        }
    }
}

module.exports = new NotificationService();