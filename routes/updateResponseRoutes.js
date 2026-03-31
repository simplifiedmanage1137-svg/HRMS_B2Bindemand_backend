const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifyToken, isAdmin, isOwnDataOrAdmin } = require('../middleware/auth');

// Get pending responses for employee
router.get('/my-pending/:employeeId', verifyToken, isOwnDataOrAdmin, async (req, res) => {
    try {
        const { employeeId } = req.params;
        
        const { data: responses, error } = await supabase
            .from('update_responses')
            .select('*')
            .eq('employee_id', employeeId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json(responses || []);
    } catch (error) {
        console.error('Error fetching pending responses:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching responses',
            error: error.message 
        });
    }
});

// Submit response
router.post('/respond', verifyToken, async (req, res) => {
    try {
        const { request_id, response_data } = req.body;
        
        // First check if the request exists and belongs to this employee
        const { data: existingRequests, error: checkError } = await supabase
            .from('update_requests')
            .select('id')
            .eq('id', request_id)
            .eq('employee_id', req.employeeId)
            .maybeSingle();

        if (checkError) throw checkError;

        if (!existingRequests) {
            return res.status(404).json({
                success: false,
                message: 'Request not found or does not belong to you'
            });
        }

        // Check if response already exists
        const { data: existingResponse, error: responseCheckError } = await supabase
            .from('update_responses')
            .select('id')
            .eq('request_id', request_id)
            .maybeSingle();

        if (responseCheckError) throw responseCheckError;

        if (existingResponse) {
            // Update existing response
            const { error: updateError } = await supabase
                .from('update_responses')
                .update({
                    response_data: response_data,
                    status: 'submitted',
                    updated_at: new Date().toISOString()
                })
                .eq('request_id', request_id);

            if (updateError) throw updateError;

            return res.json({
                success: true,
                message: 'Response updated successfully'
            });
        } else {
            // Create new response
            const { data, error } = await supabase
                .from('update_responses')
                .insert([{
                    request_id: request_id,
                    employee_id: req.employeeId,
                    response_data: response_data,
                    status: 'submitted',
                    created_at: new Date().toISOString()
                }])
                .select();

            if (error) throw error;

            // Update the request status to 'responded'
            await supabase
                .from('update_requests')
                .update({
                    status: 'responded',
                    updated_at: new Date().toISOString()
                })
                .eq('id', request_id);

            res.status(201).json({
                success: true,
                message: 'Response submitted successfully',
                response_id: data[0].id
            });
        }

    } catch (error) {
        console.error('Error submitting response:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error submitting response',
            error: error.message 
        });
    }
});

// Get all responses for a request (admin only)
router.get('/request/:requestId', verifyToken, isAdmin, async (req, res) => {
    try {
        const { requestId } = req.params;
        
        const { data: responses, error } = await supabase
            .from('update_responses')
            .select(`
                *,
                employees!inner(first_name, last_name, email)
            `)
            .eq('request_id', requestId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Format responses with employee details
        const formattedResponses = (responses || []).map(resp => ({
            ...resp,
            employee_first_name: resp.employees?.first_name,
            employee_last_name: resp.employees?.last_name,
            employee_email: resp.employees?.email,
            employees: undefined
        }));

        res.json(formattedResponses);
    } catch (error) {
        console.error('Error fetching request responses:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching responses',
            error: error.message 
        });
    }
});

// Get specific response by ID
router.get('/:responseId', verifyToken, async (req, res) => {
    try {
        const { responseId } = req.params;
        
        const { data: response, error } = await supabase
            .from('update_responses')
            .select('*')
            .eq('id', responseId)
            .maybeSingle();

        if (error) throw error;

        if (!response) {
            return res.status(404).json({
                success: false,
                message: 'Response not found'
            });
        }

        // Check if user has access (admin or the employee who submitted)
        if (req.userRole !== 'admin' && response.employee_id !== req.employeeId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        res.json(response);
    } catch (error) {
        console.error('Error fetching response:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching response',
            error: error.message 
        });
    }
});

// Get response status count for employee
router.get('/stats/:employeeId', verifyToken, isOwnDataOrAdmin, async (req, res) => {
    try {
        const { employeeId } = req.params;
        
        // Get counts for different statuses
        const { data: pending, error: pendingError } = await supabase
            .from('update_responses')
            .select('*', { count: 'exact', head: true })
            .eq('employee_id', employeeId)
            .eq('status', 'pending');

        if (pendingError) throw pendingError;

        const { data: submitted, error: submittedError } = await supabase
            .from('update_responses')
            .select('*', { count: 'exact', head: true })
            .eq('employee_id', employeeId)
            .eq('status', 'submitted');

        if (submittedError) throw submittedError;

        const { data: reviewed, error: reviewedError } = await supabase
            .from('update_responses')
            .select('*', { count: 'exact', head: true })
            .eq('employee_id', employeeId)
            .eq('status', 'reviewed');

        if (reviewedError) throw reviewedError;

        res.json({
            success: true,
            stats: {
                pending: pending || 0,
                submitted: submitted || 0,
                reviewed: reviewed || 0,
                total: (pending || 0) + (submitted || 0) + (reviewed || 0)
            }
        });
    } catch (error) {
        console.error('Error fetching response stats:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching statistics',
            error: error.message 
        });
    }
});

// Admin reviews response
router.put('/:responseId/review', verifyToken, isAdmin, async (req, res) => {
    try {
        const { responseId } = req.params;
        const { status, comments } = req.body;

        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Status must be approved or rejected'
            });
        }

        // Get response details
        const { data: response, error: fetchError } = await supabase
            .from('update_responses')
            .select('*')
            .eq('id', responseId)
            .maybeSingle();

        if (fetchError) throw fetchError;

        if (!response) {
            return res.status(404).json({
                success: false,
                message: 'Response not found'
            });
        }

        // Update response status
        const { error: updateError } = await supabase
            .from('update_responses')
            .update({
                status: status,
                admin_comments: comments || null,
                reviewed_at: new Date().toISOString(),
                reviewed_by: req.employeeId
            })
            .eq('id', responseId);

        if (updateError) throw updateError;

        // Create notification for employee
        const notificationMessage = status === 'approved' 
            ? 'Your update response has been approved.'
            : `Your update response has been rejected.${comments ? ' Reason: ' + comments : ''}`;

        await supabase
            .from('notifications')
            .insert([{
                employee_id: response.employee_id,
                title: `Response ${status === 'approved' ? 'Approved' : 'Rejected'}`,
                message: notificationMessage,
                type: `response_${status}`,
                reference_id: responseId,
                created_at: new Date().toISOString()
            }]);

        res.json({
            success: true,
            message: `Response ${status} successfully`
        });
    } catch (error) {
        console.error('Error reviewing response:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error reviewing response',
            error: error.message 
        });
    }
});

module.exports = router;