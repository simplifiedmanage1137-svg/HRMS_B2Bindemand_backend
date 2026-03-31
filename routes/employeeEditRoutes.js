const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifyToken } = require('../middleware/auth');

// Get pending edit requests for employee
router.get('/my-requests/:employeeId', verifyToken, async (req, res) => {
    try {
        const { employeeId } = req.params;
        
        // Verify employee is accessing their own data
        if (req.employeeId !== employeeId && req.userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. You can only view your own requests.'
            });
        }

        const { data: requests, error } = await supabase
            .from('admin_edit_requests')
            .select('*')
            .eq('employee_id', employeeId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false });

        if (error) throw error;
        
        res.json({
            success: true,
            requests: requests || []
        });
        
    } catch (error) {
        console.error('Error fetching requests:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch requests',
            error: error.message
        });
    }
});

// Get employee's current data for editing
router.get('/my-data/:employeeId', verifyToken, async (req, res) => {
    try {
        const { employeeId } = req.params;
        
        // Verify employee is accessing their own data
        if (req.employeeId !== employeeId && req.userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. You can only view your own data.'
            });
        }

        const { data: employees, error } = await supabase
            .from('employees')
            .select('*')
            .eq('employee_id', employeeId);

        if (error) throw error;
        
        if (!employees || employees.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        const employee = employees[0];

        // Define editable fields
        const editableFields = [
            'phone', 'address', 'emergency_contact', 'blood_group',
            'pan_number', 'aadhar_number', 'bank_account_name', 
            'account_number', 'ifsc_code', 'branch_name', 'email'
        ];

        const employeeData = {};
        editableFields.forEach(field => {
            employeeData[field] = employee[field] || '';
        });

        res.json({
            success: true,
            employee: {
                employee_id: employee.employee_id,
                first_name: employee.first_name,
                last_name: employee.last_name,
                ...employeeData
            }
        });
        
    } catch (error) {
        console.error('Error fetching employee data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch employee data',
            error: error.message
        });
    }
});

// Submit updates for approval
router.post('/submit-updates', verifyToken, async (req, res) => {
    try {
        const { employee_id, request_id, updates } = req.body;
        
        if (!employee_id || !updates || updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Employee ID and updates are required'
            });
        }

        // Verify employee is submitting their own updates
        if (req.employeeId !== employee_id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. You can only submit your own updates.'
            });
        }

        // Get current employee data
        const { data: currentData, error: fetchError } = await supabase
            .from('employees')
            .select('*')
            .eq('employee_id', employee_id)
            .single();

        if (fetchError || !currentData) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Prepare submissions
        const submissions = [];
        for (const update of updates) {
            submissions.push({
                employee_id,
                request_id: request_id || null,
                field_name: update.field,
                old_value: currentData[update.field] || '',
                new_value: update.value,
                status: 'pending',
                submitted_at: new Date().toISOString()
            });
        }

        // Insert all submissions
        const { data: insertedSubmissions, error: insertError } = await supabase
            .from('employee_update_submissions')
            .insert(submissions)
            .select();

        if (insertError) throw insertError;

        // Mark the request as completed if request_id exists
        if (request_id) {
            const { error: updateError } = await supabase
                .from('admin_edit_requests')
                .update({
                    status: 'completed',
                    completed_at: new Date().toISOString()
                })
                .eq('id', request_id);

            if (updateError) throw updateError;
        }

        // Create notification for admin
        // First check if notifications table has the required columns
        const { data: notifColumns, error: colError } = await supabase
            .from('information_schema.columns')
            .select('column_name')
            .eq('table_name', 'notifications')
            .eq('table_schema', 'public');

        const columnNames = notifColumns?.map(col => col.column_name) || [];

        const notificationData = {
            employee_id: 'ADMIN',
            message: `Employee ${currentData.first_name} ${currentData.last_name} (${employee_id}) has submitted ${updates.length} update(s) for approval.`,
            type: 'update_submitted',
            created_at: new Date().toISOString()
        };

        if (columnNames.includes('title')) {
            notificationData.title = 'Employee Updates Submitted';
        }
        if (columnNames.includes('reference_id')) {
            notificationData.reference_id = insertedSubmissions[0]?.id;
        }

        const { error: notifError } = await supabase
            .from('notifications')
            .insert([notificationData]);

        if (notifError) {
            console.log('⚠️ Could not create admin notification:', notifError.message);
        }

        res.json({
            success: true,
            message: 'Updates submitted for admin approval',
            update_count: updates.length,
            submissions: insertedSubmissions
        });

    } catch (error) {
        console.error('Error submitting updates:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit updates',
            error: error.message
        });
    }
});

// Get employee's submission history
router.get('/my-submissions/:employeeId', verifyToken, async (req, res) => {
    try {
        const { employeeId } = req.params;
        
        // Verify employee is accessing their own submissions
        if (req.employeeId !== employeeId && req.userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. You can only view your own submissions.'
            });
        }

        const { data: submissions, error } = await supabase
            .from('employee_update_submissions')
            .select('*')
            .eq('employee_id', employeeId)
            .order('submitted_at', { ascending: false });

        if (error) throw error;
        
        res.json({
            success: true,
            submissions: submissions || []
        });
        
    } catch (error) {
        console.error('Error fetching submissions:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch submissions',
            error: error.message
        });
    }
});

// Get all submissions for admin
router.get('/all-submissions', verifyToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Admin access required'
            });
        }

        const { data: submissions, error } = await supabase
            .from('employee_update_submissions')
            .select(`
                *,
                employees!inner(first_name, last_name, email, department)
            `)
            .order('submitted_at', { ascending: false });

        if (error) throw error;

        // Format the response
        const formattedSubmissions = (submissions || []).map(sub => ({
            ...sub,
            employee_first_name: sub.employees?.first_name,
            employee_last_name: sub.employees?.last_name,
            employee_email: sub.employees?.email,
            employee_department: sub.employees?.department,
            employees: undefined
        }));

        res.json({
            success: true,
            submissions: formattedSubmissions
        });
        
    } catch (error) {
        console.error('Error fetching all submissions:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch submissions',
            error: error.message
        });
    }
});

// Admin approve/reject submission
router.put('/submission/:submissionId', verifyToken, async (req, res) => {
    try {
        const { submissionId } = req.params;
        const { status, admin_comments } = req.body;

        // Check if user is admin
        if (req.userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Admin access required'
            });
        }

        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Status must be approved or rejected'
            });
        }

        // Get submission details
        const { data: submission, error: fetchError } = await supabase
            .from('employee_update_submissions')
            .select('*')
            .eq('id', submissionId)
            .single();

        if (fetchError || !submission) {
            return res.status(404).json({
                success: false,
                message: 'Submission not found'
            });
        }

        // Start update
        if (status === 'approved') {
            // Update the actual employee record
            const { error: updateError } = await supabase
                .from('employees')
                .update({ [submission.field_name]: submission.new_value })
                .eq('employee_id', submission.employee_id);

            if (updateError) throw updateError;
        }

        // Update submission status
        const { error: updateError } = await supabase
            .from('employee_update_submissions')
            .update({
                status,
                admin_comments: admin_comments || null,
                reviewed_at: new Date().toISOString(),
                reviewed_by: req.employeeId
            })
            .eq('id', submissionId);

        if (updateError) throw updateError;

        // Create notification for employee
        const notificationMessage = status === 'approved' 
            ? `Your update request for ${submission.field_name} has been approved.`
            : `Your update request for ${submission.field_name} has been rejected. ${admin_comments ? 'Reason: ' + admin_comments : ''}`;

        const { error: notifError } = await supabase
            .from('notifications')
            .insert([{
                employee_id: submission.employee_id,
                title: `Update ${status}`,
                message: notificationMessage,
                type: `update_${status}`,
                created_at: new Date().toISOString()
            }]);

        if (notifError) {
            console.log('⚠️ Could not create employee notification:', notifError.message);
        }

        res.json({
            success: true,
            message: `Submission ${status} successfully`
        });

    } catch (error) {
        console.error('Error updating submission:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update submission',
            error: error.message
        });
    }
});

module.exports = router;