// routes/employeeUpdateRoutes.js
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifyToken } = require('../middleware/auth');

// ============== STEP 1: Get pending requests for employee ==============
router.get('/pending-requests', verifyToken, async (req, res) => {
    try {
        console.log('📋 Fetching pending requests for employee:', req.employeeId);

        const { data: requests, error } = await supabase
            .from('update_requests')
            .select('*')
            .eq('employee_id', req.employeeId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json(requests || []);
    } catch (error) {
        console.error('❌ Error:', error);
        res.json([]);
    }
});

// ============== STEP 2: Accept request (employee accepts to work on it) ==============
router.post('/accept-request/:requestId', verifyToken, async (req, res) => {
    try {
        const { requestId } = req.params;

        // Check if request exists and belongs to this employee
        const { data: request, error: fetchError } = await supabase
            .from('update_requests')
            .select('*')
            .eq('id', requestId)
            .eq('employee_id', req.employeeId)
            .single();

        if (fetchError || !request) {
            return res.status(404).json({ 
                success: false, 
                message: 'Request not found' 
            });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({ 
                success: false, 
                message: 'Request is not in pending state' 
            });
        }

        // Update status to in_progress
        const { error: updateError } = await supabase
            .from('update_requests')
            .update({ 
                status: 'in_progress', // Step 2: In Progress (employee is editing)
                updated_at: new Date().toISOString()
            })
            .eq('id', requestId);

        if (updateError) throw updateError;

        res.json({ 
            success: true, 
            message: 'Request accepted successfully',
            request: request 
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// ============== STEP 3: Get current employee data for editing ==============
router.get('/current-data', verifyToken, async (req, res) => {
    try {
        const { data: employee, error } = await supabase
            .from('employees')
            .select('*')
            .eq('employee_id', req.employeeId)
            .single();

        if (error) throw error;

        res.json(employee);
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching data' 
        });
    }
});

// ============== STEP 4: Submit updated data for approval ==============

// routes/employeeUpdateRoutes.js - Update submit-update endpoint

router.post('/submit-update', verifyToken, async (req, res) => {
    try {
        const { requestId, updatedData, isDocumentUpdate } = req.body;

        console.log('📝 Submitting update for request:', requestId);
        console.log('Is document update:', isDocumentUpdate);
        console.log('Updated data:', updatedData);

        // Get request
        const { data: request, error: fetchError } = await supabase
            .from('update_requests')
            .select('*')
            .eq('id', requestId)
            .eq('employee_id', req.employeeId)
            .single();

        if (fetchError || !request) {
            console.error('❌ Request not found:', fetchError);
            return res.status(404).json({ 
                success: false, 
                message: 'Request not found' 
            });
        }

        if (request.status !== 'in_progress') {
            return res.status(400).json({ 
                success: false, 
                message: 'Request is not in progress' 
            });
        }

        // Prepare update data
        const updatePayload = {
            status: 'completed',
            updated_at: new Date().toISOString()
        };

        // For document updates, store document info
        if (isDocumentUpdate) {
            updatePayload.employee_data = {
                documents_uploaded_at: new Date().toISOString(),
                uploaded_documents: updatedData
            };
            updatePayload.is_document_update = true;
        } else {
            // For regular info updates, store the updated data
            updatePayload.employee_data = updatedData;
        }

        // Update request with employee data and mark as completed
        const { error: updateError } = await supabase
            .from('update_requests')
            .update(updatePayload)
            .eq('id', requestId);

        if (updateError) {
            console.error('❌ Update error:', updateError);
            throw updateError;
        }

        console.log('✅ Request updated to completed with ID:', requestId);

        // Create notification for admin
        try {
            // Get admin users
            const { data: admins, error: adminError } = await supabase
                .from('users')
                .select('employee_id')
                .eq('role', 'admin')
                .limit(1);

            if (admins && admins.length > 0) {
                const adminId = admins[0].employee_id;
                const notificationTitle = isDocumentUpdate ? 'Document Upload Ready for Review' : 'Update Request Ready for Review';
                const notificationMessage = isDocumentUpdate 
                    ? `Employee ${req.employeeId} has uploaded documents for review.`
                    : `Employee ${req.employeeId} has submitted updated information for review.`;

                await supabase
                    .from('admin_notifications')
                    .insert([{
                        admin_id: adminId,
                        title: notificationTitle,
                        message: notificationMessage,
                        type: isDocumentUpdate ? 'document_upload' : 'info_update',
                        reference_id: requestId,
                        created_at: new Date().toISOString(),
                        is_read: false
                    }]);
                console.log('✅ Admin notification created');
            }
        } catch (notifError) {
            console.error('⚠️ Error creating admin notification:', notifError);
        }

        res.json({ 
            success: true,
            message: isDocumentUpdate 
                ? 'Documents uploaded successfully. Waiting for admin approval.' 
                : 'Update submitted successfully. Waiting for admin approval.'
        });

    } catch (error) {
        console.error('❌ Error submitting update:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error submitting update' 
        });
    }
});

// Get specific request details
router.get('/request/:requestId', verifyToken, async (req, res) => {
  try {
    const { requestId } = req.params;

    const { data: requests, error } = await supabase
      .from('update_requests')
      .select('*')
      .eq('id', requestId);

    if (error) throw error;

    if (!requests || requests.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Request not found' 
      });
    }

    const request = requests[0];

    // Verify ownership
    if (request.employee_id !== req.employeeId) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    res.json(request);
  } catch (error) {
    console.error('❌ Error fetching request:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching request',
      error: error.message 
    });
  }
});

module.exports = router; 