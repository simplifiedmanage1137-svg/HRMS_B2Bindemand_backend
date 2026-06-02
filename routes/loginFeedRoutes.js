// backend/routes/loginFeedRoutes.js
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Multer for office event media
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '../uploads/office-events');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `event-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/^(image|video)\//.test(file.mimetype)) cb(null, true);
        else cb(new Error('Only image/video files allowed'));
    }
});

const getWeekRange = () => {
    const now = new Date();
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { monday, sunday };
};

const buildFileUrl = (req, folder, filename) => {
    if (!filename) return null;
    const base = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
    return `${base}/uploads/${folder}/${filename}`;
};

// GET /api/public/login-feed — no auth
router.get('/login-feed', async (req, res) => {
    try {
        const { monday, sunday } = getWeekRange();
        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();

        const { data: employees } = await supabase
            .from('employees')
            .select('employee_id, first_name, last_name, dob, joining_date, department, designation, profile_image, is_active')
            .eq('is_active', true);

        const emps = employees || [];

        // 1. Birthdays this week
        const birthdays = emps.filter(e => {
            if (!e.dob) return false;
            const d = new Date(e.dob);
            const thisYear = new Date(now.getFullYear(), d.getMonth(), d.getDate());
            return thisYear >= monday && thisYear <= sunday;
        }).map(e => ({
            type: 'birthday',
            employee_id: e.employee_id,
            name: `${e.first_name} ${e.last_name}`,
            department: e.department,
            designation: e.designation,
            profile_image: e.profile_image ? buildFileUrl(req, 'profiles', e.profile_image) : null,
        }));

        // 2. Work anniversaries this week
        const anniversaries = emps.filter(e => {
            if (!e.joining_date) return false;
            const j = new Date(e.joining_date);
            const years = now.getFullYear() - j.getFullYear();
            const thisYear = new Date(now.getFullYear(), j.getMonth(), j.getDate());
            return years > 0 && thisYear >= monday && thisYear <= sunday;
        }).map(e => {
            const j = new Date(e.joining_date);
            return {
                type: 'anniversary',
                employee_id: e.employee_id,
                name: `${e.first_name} ${e.last_name}`,
                department: e.department,
                designation: e.designation,
                profile_image: e.profile_image ? buildFileUrl(req, 'profiles', e.profile_image) : null,
                years: now.getFullYear() - j.getFullYear(),
            };
        });

        // 3. New joinings this week
        const newJoinings = emps.filter(e => {
            if (!e.joining_date) return false;
            const j = new Date(e.joining_date);
            return j >= monday && j <= sunday;
        }).map(e => ({
            type: 'new_joining',
            employee_id: e.employee_id,
            name: `${e.first_name} ${e.last_name}`,
            department: e.department,
            designation: e.designation,
            profile_image: e.profile_image ? buildFileUrl(req, 'profiles', e.profile_image) : null,
            joining_date: e.joining_date,
        }));

        // 4. Top rated employees this month (rating >= 4)
        const { data: ratings } = await supabase
            .from('employee_ratings')
            .select('employee_id, rating, rated_by_role')
            .eq('rating_month', month)
            .eq('rating_year', year)
            .gte('rating', 4)
            .order('rating', { ascending: false });

        const topMap = {};
        (ratings || []).forEach(r => {
            if (!topMap[r.employee_id] || r.rating > topMap[r.employee_id].rating)
                topMap[r.employee_id] = r;
        });
        const topRated = Object.values(topMap).slice(0, 6).map(r => {
            const emp = emps.find(e => e.employee_id === r.employee_id);
            return {
                type: 'top_rated',
                employee_id: r.employee_id,
                name: emp ? `${emp.first_name} ${emp.last_name}` : r.employee_id,
                department: emp?.department || '',
                designation: emp?.designation || '',
                profile_image: emp?.profile_image ? buildFileUrl(req, 'profiles', emp.profile_image) : null,
                rating: r.rating,
                rated_by: r.rated_by_role,
            };
        });

        // 5. Active announcements
        const { data: announcements } = await supabase
            .from('announcements')
            .select('id, title, message, type, priority, image_url, created_at')
            .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`)
            .order('created_at', { ascending: false })
            .limit(5);

        // 6. Broadcast notices (employee_id = 'ALL')
        const { data: notices } = await supabase
            .from('employee_notices')
            .select('id, title, message, type, created_at, sender_name')
            .eq('employee_id', 'ALL')
            .order('created_at', { ascending: false })
            .limit(5);

        // 7. Office event media
        const { data: events } = await supabase
            .from('office_events')
            .select('id, title, description, media_url, media_type, event_date, created_at')
            .order('event_date', { ascending: false })
            .limit(8);

        // 8. Comp-off dates this month — one card per holiday in the current month from calendar
        const { holidays: allHolidays } = require('../data/holidays');
        const monthStr = String(month).padStart(2, '0');
        const compOffCards = allHolidays
            .filter(h => h.date.startsWith(`${year}-${monthStr}`))
            .map(h => ({
                type: 'comp_off',
                holiday_date: h.date,
                holiday_name: h.name,
                region: h.region,
                month, year,
            }));

        const monthLabel = new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' });

        res.json({
            success: true,
            data: {
                birthdays,
                anniversaries,
                new_joinings: newJoinings,
                top_rated: topRated,
                announcements: (announcements || []).map(a => ({ ...a, type: 'announcement' })),
                notices: (notices || []).map(n => ({ ...n, type: 'notice' })),
                office_events: (events || []).map(e => ({
                    ...e,
                    type: 'office_event',
                    media_url: e.media_url ? buildFileUrl(req, 'office-events', e.media_url) : null,
                })),
                comp_offs: compOffCards,
                month_label: monthLabel,
                week: {
                    start: monday.toISOString().split('T')[0],
                    end: sunday.toISOString().split('T')[0],
                },
            }
        });
    } catch (err) {
        console.error('Login feed error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/public/office-events — admin uploads event media (called from admin panel with auth)
router.post('/office-events', upload.single('media'), async (req, res) => {
    try {
        const { title, description, event_date } = req.body;
        if (!req.file) return res.status(400).json({ success: false, message: 'Media file required' });
        const isVideo = req.file.mimetype.startsWith('video/');
        const { data, error } = await supabase.from('office_events').insert([{
            title: title || 'Office Event',
            description: description || null,
            media_url: req.file.filename,
            media_type: isVideo ? 'video' : 'image',
            event_date: event_date || new Date().toISOString().split('T')[0],
            created_at: new Date().toISOString(),
        }]).select();
        if (error) throw error;
        res.json({ success: true, event: data[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE /api/public/office-events/:id
router.delete('/office-events/:id', async (req, res) => {
    try {
        const { data: ev } = await supabase.from('office_events').select('media_url').eq('id', req.params.id).single();
        const { error } = await supabase.from('office_events').delete().eq('id', req.params.id);
        if (error) throw error;
        if (ev?.media_url) {
            const fp = path.join(__dirname, '../uploads/office-events', ev.media_url);
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
