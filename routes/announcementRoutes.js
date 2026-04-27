const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Multer config — save to uploads/announcements/
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '../uploads/announcements');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `announcement-${Date.now()}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (/^image\/(jpeg|jpg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
        else cb(new Error('Only image files allowed (jpg, png, gif, webp)'));
    }
});

// GET /api/announcements — all active announcements (all authenticated users)
router.get('/', async (req, res) => {
    try {
        let query = supabase
            .from('announcements')
            .select('*')
            .order('created_at', { ascending: false });

        // Filter out expired announcements
        const now = new Date().toISOString();
        query = query.or(`expires_at.is.null,expires_at.gt.${now}`);

        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, announcements: data || [] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch announcements', error: error.message });
    }
});

// POST /api/announcements — create with optional image (admin only)
router.post('/', upload.single('image'), async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        const { title, message, type, priority, expires_at } = req.body;
        if (!title?.trim() || !message?.trim()) {
            return res.status(400).json({ success: false, message: 'Title and message are required' });
        }

        // Build image URL if file uploaded
        let image_url = null;
        if (req.file) {
            const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 5000}`;
            image_url = `${baseUrl}/uploads/announcements/${req.file.filename}`;
        }

        const { data, error } = await supabase
            .from('announcements')
            .insert([{
                title: title.trim(),
                message: message.trim(),
                type: type || 'announcement',
                priority: priority || 'normal',
                created_by: req.user.employeeId,
                expires_at: expires_at || null,
                image_url
            }])
            .select();
        if (error) throw error;
        res.json({ success: true, announcement: data[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to create announcement', error: error.message });
    }
});

// DELETE /api/announcements/:id — delete with image cleanup (admin only)
router.delete('/:id', async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        // Fetch image_url before delete to clean up file
        const { data: ann } = await supabase
            .from('announcements').select('image_url').eq('id', req.params.id).single();
        
        const { error } = await supabase
            .from('announcements').delete().eq('id', req.params.id);
        if (error) throw error;

        // Delete image file if exists
        if (ann?.image_url) {
            const filename = ann.image_url.split('/').pop();
            const filePath = path.join(__dirname, '../uploads/announcements', filename);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }

        res.json({ success: true, message: 'Announcement deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete announcement', error: error.message });
    }
});

module.exports = router;
