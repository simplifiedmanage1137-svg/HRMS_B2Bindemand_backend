const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

const isTeamLeader = (designation) => {
    if (!designation) return false;
    const d = designation.toLowerCase();
    return d.includes('team leader') || d.includes('team manager') ||
           d.includes('tl') || d.includes('lead') || d.includes('manager') ||
           d.includes('head') || d.includes('supervisor');
};

// POST /api/notices - Send notice/warning to employee
router.post('/', async (req, res) => {
    try {
        const { employee_id, title, message, type } = req.body;
        const sender_id = req.user?.employeeId;
        const sender_role = req.user?.role;

        if (!employee_id || !title || !message) {
            return res.status(400).json({ success: false, message: 'employee_id, title, and message are required' });
        }

        // Verify sender is admin or team leader/manager
        if (sender_role !== 'admin') {
            const { data: senderEmp } = await supabase
                .from('employees').select('designation').eq('employee_id', sender_id).single();
            if (!isTeamLeader(senderEmp?.designation)) {
                return res.status(403).json({ success: false, message: 'Only admin or team leaders can send notices' });
            }
            // Team leader can only send to their own team members
            const { data: senderData } = await supabase
                .from('employees').select('first_name, last_name').eq('employee_id', sender_id).single();
            const senderName = senderData ? `${senderData.first_name} ${senderData.last_name}` : '';
            const { data: targetEmp } = await supabase
                .from('employees').select('reporting_manager').eq('employee_id', employee_id).single();
            if (targetEmp?.reporting_manager !== senderName) {
                return res.status(403).json({ success: false, message: 'You can only send notices to your own team members' });
            }
        }

        const { data: senderInfo } = await supabase
            .from('employees').select('first_name, last_name').eq('employee_id', sender_id).single();
        const sender_name = senderInfo ? `${senderInfo.first_name} ${senderInfo.last_name}` : (sender_role === 'admin' ? 'Admin' : sender_id);

        const { data, error } = await supabase.from('employee_notices').insert([{
            employee_id,
            title,
            message,
            type: type || 'notice',
            sent_by_id: sender_id,
            sent_by_role: sender_role,
            sender_name,
            is_read: false,
            created_at: new Date().toISOString()
        }]).select();

        if (error) throw error;
        res.json({ success: true, message: 'Notice sent successfully', notice: data[0] });
    } catch (error) {
        console.error('Error sending notice:', error);
        res.status(500).json({ success: false, message: 'Failed to send notice', error: error.message });
    }
});

// GET /api/notices - Get notices for logged-in employee
router.get('/', async (req, res) => {
    try {
        const user_id = req.user?.employeeId;
        const user_role = req.user?.role;

        let query = supabase.from('employee_notices').select('*');

        if (user_role === 'admin') {
            // Admin sees all notices they sent
            query = query.eq('sent_by_id', user_id);
        } else {
            // Check if team leader - see notices they sent + notices they received
            const { data: emp } = await supabase
                .from('employees').select('designation').eq('employee_id', user_id).single();

            if (isTeamLeader(emp?.designation)) {
                // Team leader sees notices they sent OR received
                const { data: sent } = await supabase.from('employee_notices').select('*').eq('sent_by_id', user_id).order('created_at', { ascending: false });
                const { data: received } = await supabase.from('employee_notices').select('*').eq('employee_id', user_id).order('created_at', { ascending: false });
                const all = [...(sent || []), ...(received || [])];
                const unique = all.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
                unique.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                return res.json({ success: true, notices: unique });
            } else {
                // Regular employee sees only their own notices
                query = query.eq('employee_id', user_id);
            }
        }

        query = query.order('created_at', { ascending: false });
        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, notices: data || [] });
    } catch (error) {
        console.error('Error fetching notices:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch notices', error: error.message });
    }
});

// GET /api/notices/employee/:employeeId - Get notices for a specific employee (admin/manager use)
router.get('/employee/:employeeId', async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { data, error } = await supabase
            .from('employee_notices').select('*')
            .eq('employee_id', employeeId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, notices: data || [] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch notices', error: error.message });
    }
});

// PATCH /api/notices/:id/read - Mark notice as read
router.patch('/:id/read', async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from('employee_notices').update({ is_read: true }).eq('id', id);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to mark as read', error: error.message });
    }
});

// DELETE /api/notices/:id - Delete notice (only sender can delete)
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const user_id = req.user?.employeeId;
        const user_role = req.user?.role;

        const { data: notice, error: fetchError } = await supabase
            .from('employee_notices').select('sent_by_id, sent_by_role').eq('id', id).single();
        if (fetchError || !notice) return res.status(404).json({ success: false, message: 'Notice not found' });

        // Only the original sender can delete
        if (notice.sent_by_id !== user_id) {
            return res.status(403).json({ success: false, message: 'Only the sender can delete this notice' });
        }

        const { error } = await supabase.from('employee_notices').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'Notice deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete notice', error: error.message });
    }
});

module.exports = router;
