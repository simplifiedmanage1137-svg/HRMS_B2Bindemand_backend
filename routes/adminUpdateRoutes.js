// routes/adminUpdateRoutes.js
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifyToken, isAdmin } = require('../middleware/auth');

// Get all employees for admin
router.get('/employees', verifyToken, isAdmin, async (req, res) => {
    try {
        console.log('📋 Fetching employees for admin...');

        const { data: employees, error } = await supabase
            .from('employees')
            .select('id, employee_id, first_name, last_name, email, designation, department, phone')
            .order('first_name', { ascending: true });

        if (error) throw error;

        console.log(`✅ Found ${employees?.length || 0} employees`);
        res.json(employees || []);

    } catch (error) {
        console.error('❌ Error fetching employees:', error);
        res.json([]);
    }
});

// Get pending requests count
router.get('/pending-count', verifyToken, isAdmin, async (req, res) => {
    try {
        const { count, error } = await supabase
            .from('update_requests')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'completed');

        if (error) throw error;

        res.json({ count: count || 0 });

    } catch (error) {
        console.error('❌ Error fetching pending count:', error);
        res.json({ count: 0 });
    }
});

// Get all pending requests
router.get('/pending-requests', verifyToken, isAdmin, async (req, res) => {
    try {
        const { data: requests, error } = await supabase
            .from('update_requests')
            .select(`
                *,
                employees!inner(first_name, last_name, email, designation, department)
            `)
            .in('status', ['pending', 'in_progress'])
            .order('created_at', { ascending: false });

        if (error) throw error;

        const formattedRequests = (requests || []).map(req => ({
            ...req,
            requested_fields: req.requested_fields || [],
            employee_data: req.employee_data || null,
            first_name: req.employees?.first_name,
            last_name: req.employees?.last_name,
            email: req.employees?.email,
            designation: req.employees?.designation,
            department: req.employees?.department,
            employees: undefined
        }));

        res.json(formattedRequests);

    } catch (error) {
        console.error('❌ Error fetching pending requests:', error);
        res.json([]);
    }
});

// Send update request to employee - UPDATED with document support
router.post('/send-request', verifyToken, isAdmin, async (req, res) => {
    const requestedFields = req.body.requested_fields || [];
    const requestedFieldNames = req.body.requested_field_names || [];

    // Ensure aadhar_number is included if bank section is selected
    let finalRequestedFields = [...requestedFields];
    let finalFieldNames = [...requestedFieldNames];

    if (requestedFields.includes('bank')) {
        if (!finalFieldNames.includes('aadhar_number')) {
            finalFieldNames.push('aadhar_number');
        }
    }

    try {
        const { employee_id, requested_fields, notes, document_types } = req.body;

        console.log('='.repeat(50));
        console.log('📝 SENDING UPDATE REQUEST');
        console.log('Employee ID:', employee_id);
        console.log('Requested fields:', requested_fields);
        console.log('Document types:', document_types);
        console.log('='.repeat(50));

        // Check if this is a document update request
        const isDocumentUpdate = requested_fields.includes('documents') && document_types && document_types.length > 0;

        const insertData = {
            employee_id,
            admin_id: req.userId,
            requested_fields: requested_fields || [],
            notes: notes || null,
            status: 'pending',
            is_document_update: isDocumentUpdate,
            document_types: document_types || [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('update_requests')
            .insert([insertData])
            .select();

        if (error) throw error;

        // Create notification for employee
        let notificationMessage = `Admin has requested you to update your ${requested_fields.join(', ')} information.`;

        if (isDocumentUpdate) {
            notificationMessage = `Admin has requested you to upload the following documents: ${document_types.join(', ')}.`;
        }

        await supabase
            .from('notifications')
            .insert([{
                employee_id: employee_id,
                title: 'Information Update Request',
                message: notificationMessage,
                type: 'update_request',
                reference_id: data[0].id,
                is_read: false,
                created_at: new Date().toISOString()
            }]);

        res.status(201).json({
            success: true,
            message: 'Update request sent successfully',
            request_id: data[0].id,
            is_document_update: isDocumentUpdate
        });

    } catch (error) {
        console.error('❌ Error sending update request:', error);
        res.status(500).json({
            success: false,
            message: 'Error sending request',
            error: error.message
        });
    }
});

// Get completed requests
router.get('/completed-requests', verifyToken, isAdmin, async (req, res) => {
    try {
        console.log('='.repeat(50));
        console.log('📋 FETCHING COMPLETED REQUESTS');
        console.log('Admin ID:', req.userId);
        console.log('='.repeat(50));

        const { data: requests, error } = await supabase
            .from('update_requests')
            .select('*')
            .eq('status', 'completed')
            .order('updated_at', { ascending: false });

        if (error) {
            console.error('❌ Supabase error:', error);
            return res.status(500).json({
                success: false,
                message: 'Database error',
                error: error.message
            });
        }

        console.log(`✅ Found ${requests?.length || 0} completed requests`);

        if (!requests || requests.length === 0) {
            return res.json([]);
        }

        const formattedRequests = [];

        for (const req of requests) {
            try {
                const { data: employee, error: empError } = await supabase
                    .from('employees')
                    .select('first_name, last_name, email, department, designation')
                    .eq('employee_id', req.employee_id)
                    .single();

                if (empError) {
                    console.warn(`⚠️ Could not fetch employee for ${req.employee_id}:`, empError);
                }

                formattedRequests.push({
                    id: req.id,
                    employee_id: req.employee_id,
                    status: req.status,
                    requested_fields: req.requested_fields || [],
                    employee_data: req.employee_data || {},
                    notes: req.notes,
                    created_at: req.created_at,
                    updated_at: req.updated_at,
                    is_document_update: req.is_document_update || false,
                    document_types: req.document_types || [],
                    employee_name: employee ? `${employee.first_name || ''} ${employee.last_name || ''}`.trim() : 'Unknown',
                    employee_email: employee?.email,
                    employee_department: employee?.department,
                    employee_designation: employee?.designation
                });

            } catch (empErr) {
                console.error(`❌ Error processing request ${req.id}:`, empErr);
                formattedRequests.push({
                    id: req.id,
                    employee_id: req.employee_id,
                    status: req.status,
                    requested_fields: req.requested_fields || [],
                    employee_data: req.employee_data || {},
                    notes: req.notes,
                    created_at: req.created_at,
                    updated_at: req.updated_at,
                    is_document_update: req.is_document_update || false,
                    document_types: req.document_types || [],
                    employee_name: 'Unknown',
                    employee_email: null,
                    employee_department: null,
                    employee_designation: null
                });
            }
        }

        console.log(`✅ Sending ${formattedRequests.length} formatted requests`);
        res.json(formattedRequests);

    } catch (error) {
        console.error('❌ Error fetching completed requests:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching requests',
            error: error.message
        });
    }
});

// routes/adminUpdateRoutes.js - Updated handle-request endpoint

router.post('/handle-request', verifyToken, isAdmin, async (req, res) => {
    try {
        const { request_id, action } = req.body;

        console.log('='.repeat(50));
        console.log('📝 HANDLE REQUEST');
        console.log('Request ID:', request_id);
        console.log('Action:', action);
        console.log('='.repeat(50));

        if (!request_id) {
            return res.status(400).json({
                success: false,
                message: 'Request ID is required'
            });
        }

        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({
                success: false,
                message: 'Action must be approve or reject'
            });
        }

        // Get request details
        const { data: request, error: fetchError } = await supabase
            .from('update_requests')
            .select('*')
            .eq('id', request_id)
            .single();

        if (fetchError || !request) {
            console.error('Request not found:', fetchError);
            return res.status(404).json({
                success: false,
                message: 'Request not found'
            });
        }

        console.log('✅ Found request:', {
            id: request.id,
            employee_id: request.employee_id,
            status: request.status,
            is_document_update: request.is_document_update,
            document_types: request.document_types,
            has_employee_data: !!request.employee_data
        });

        // Check if request can be actioned
        if (!['pending', 'completed', 'in_progress'].includes(request.status)) {
            return res.status(400).json({
                success: false,
                message: `Request cannot be actioned. Current status: ${request.status}`
            });
        }

        const newStatus = action === 'approve' ? 'approved' : 'rejected';

        // If approved and there's employee data, update employee record
        if (action === 'approve' && request.employee_data && Object.keys(request.employee_data).length > 0) {
            try {
                console.log('📝 Updating employee data for:', request.employee_id);
                console.log('Employee data to update:', request.employee_data);

                // Only include fields that exist in employees table
                const ALLOWED_EMPLOYEE_FIELDS = [
                    'first_name', 'middle_name', 'last_name', 'dob', 'blood_group',
                    'email', 'phone', 'address', 'city', 'state', 'pincode',
                    'bank_account_name', 'account_number', 'ifsc_code', 'branch_name',
                    'pan_number', 'aadhar_number',
                    'designation', 'department', 'employment_type', 'shift_timing',
                    'reporting_manager', 'emergency_contact',
                    'gross_salary', 'in_hand_salary'
                ];

                const filteredData = {};
                for (const [key, value] of Object.entries(request.employee_data)) {
                    if (ALLOWED_EMPLOYEE_FIELDS.includes(key) && value !== undefined && value !== null) {
                        filteredData[key] = value;
                    }
                }

                if (Object.keys(filteredData).length === 0) {
                    console.log('⚠️ No valid fields to update');
                } else {
                    console.log('📝 Filtered update data:', filteredData);

                    const { error: empUpdateError } = await supabase
                        .from('employees')
                        .update(filteredData)
                        .eq('employee_id', request.employee_id);

                    if (empUpdateError) {
                        console.error('❌ Error updating employee:', empUpdateError);
                    } else {
                        console.log('✅ Employee data updated successfully:', Object.keys(filteredData));
                    }
                }
            } catch (empError) {
                console.error('❌ Employee update failed:', empError);
            }
        }

        // For document-only requests, no employee data update needed
        if (action === 'approve' && request.is_document_update) {
            console.log('📝 Document-only request - no employee data to update');

            // Optionally update a flag in employees table that documents were updated
            try {
                const { error: docUpdateError } = await supabase
                    .from('employees')
                    .update({
                        documents_updated_at: new Date().toISOString(),
                        last_document_update: request.document_types
                    })
                    .eq('employee_id', request.employee_id);

                if (docUpdateError) {
                    console.error('⚠️ Error updating document timestamp:', docUpdateError);
                }
            } catch (docErr) {
                console.error('⚠️ Document update error:', docErr);
            }
        }

        // Update request status
        const updateData = {
            status: newStatus,
            updated_at: new Date().toISOString()
        };

        // Add reviewed_by if available
        if (req.employeeId) {
            updateData.reviewed_by = req.employeeId;
        }

        console.log('📝 Updating request with:', updateData);

        const { error: updateError } = await supabase
            .from('update_requests')
            .update(updateData)
            .eq('id', request_id);

        if (updateError) {
            console.error('❌ Error updating request:', updateError);
            throw updateError;
        }

        console.log(`✅ Request ${action}ed successfully, new status: ${newStatus}`);

        // Create notification for employee
        let notificationMessage = '';
        let notificationTitle = '';

        if (action === 'approve') {
            if (request.is_document_update) {
                notificationTitle = 'Documents Approved';
                notificationMessage = `Your uploaded documents (${request.document_types?.map(d => d.replace(/_/g, ' ').toUpperCase()).join(', ')}) have been approved by admin.`;
            } else {
                notificationTitle = 'Update Request Approved';
                notificationMessage = 'Your information update request has been approved by admin.';
            }
        } else {
            if (request.is_document_update) {
                notificationTitle = 'Documents Rejected';
                notificationMessage = `Your uploaded documents have been rejected by admin. Please upload again if needed.`;
            } else {
                notificationTitle = 'Update Request Rejected';
                notificationMessage = `Your information update request has been rejected by admin.`;
            }
        }

        try {
            await supabase
                .from('notifications')
                .insert([{
                    employee_id: request.employee_id,
                    title: notificationTitle,
                    message: notificationMessage,
                    type: `update_${action === 'approve' ? 'approved' : 'rejected'}`,
                    reference_id: request_id,
                    created_at: new Date().toISOString(),
                    read: false
                }]);
            console.log('✅ Notification created for employee');
        } catch (notifError) {
            console.error('⚠️ Error creating notification:', notifError);
        }

        res.json({
            success: true,
            message: `Request ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
            status: newStatus,
            is_document_update: request.is_document_update
        });

    } catch (error) {
        console.error('❌ Error handling request:', error);
        console.error('Error stack:', error.stack);

        res.status(500).json({
            success: false,
            message: 'Error processing request',
            error: error.message
        });
    }
});

// Mark all notifications as read for admin
router.post('/mark-notifications-read', verifyToken, isAdmin, async (req, res) => {
    try {
        console.log('📋 Marking all notifications as read for admin:', req.userId);

        const { error } = await supabase
            .from('admin_notifications')
            .update({ is_read: true })
            .eq('admin_id', req.userId)
            .eq('is_read', false);

        if (error) throw error;

        res.json({
            success: true,
            message: 'All notifications marked as read'
        });

    } catch (error) {
        console.error('❌ Error marking notifications as read:', error);
        res.status(500).json({
            success: false,
            message: 'Error marking notifications as read',
            error: error.message
        });
    }
});

module.exports = router;