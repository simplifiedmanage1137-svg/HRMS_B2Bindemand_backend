// server.js - FIXED CORS CONFIGURATION
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const cron = require('node-cron');

// Load environment variables
dotenv.config();

// Import Supabase configuration
const supabase = require('./config/supabase');

// Import routes
const authRoutes = require('./routes/authRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const leaveRoutes = require('./routes/leaveRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const salaryRoutes = require('./routes/salaryRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const adminUpdateRoutes = require('./routes/adminUpdateRoutes');
const employeeUpdateRoutes = require('./routes/employeeUpdateRoutes');
const updateResponseRoutes = require('./routes/updateResponseRoutes');
const noticeRoutes = require('./routes/noticeRoutes');
const announcementRoutes = require('./routes/announcementRoutes');

// Import attendance controller for cron jobs
const attendanceController = require('./controllers/attendanceController');

// Initialize Express app
const app = express();

// ============== DETERMINE ENVIRONMENT ==============
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 5000;

console.log('='.repeat(70));
console.log('🚀 SERVER INITIALIZING');
console.log(`Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
console.log(`Port: ${PORT}`);
console.log('='.repeat(70));

// ============== CORS CONFIGURATION ==============
const allowedOriginsFromEnv = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : [];

// Define allowed origins (including your Vercel frontend)
const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'https://hrms-b2-bindemand-a31u.vercel.app', // Your Vercel frontend
    'https://hrms-b2bindemand-backend.onrender.com', // Your backend URL
    ...allowedOriginsFromEnv
];

// Remove duplicates
const uniqueAllowedOrigins = [...new Set(allowedOrigins)];

console.log('🔧 CORS Allowed Origins:');
uniqueAllowedOrigins.forEach(origin => {
    console.log(`   - ${origin}`);
});

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (mobile apps, curl, Postman, same-origin)
        if (!origin) return callback(null, true);

        // Allow all localhost/127.0.0.1 ports (any machine running locally)
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
            return callback(null, true);
        }

        // Allow local network IPs (192.168.x.x, 10.x.x.x) for LAN access
        if (/^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(origin)) {
            return callback(null, true);
        }

        // Allow explicitly listed origins from env
        if (uniqueAllowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        console.log(`❌ CORS blocked: ${origin}`);
        return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type', 'Authorization', 'X-Requested-With',
        'Accept', 'Origin', 'employee-id', 'X-Employee-Id'
    ],
    maxAge: 86400
}));



// Simple CORS logging middleware
app.use((req, res, next) => {
    const origin = req.headers.origin;
    console.log(`📍 ${req.method} ${req.url} - Origin: ${origin || 'no origin'}`);
    next();
});

// ============== OTHER MIDDLEWARE ==============
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============== CREATE UPLOAD DIRECTORIES ==============
const createUploadDirectories = () => {
    const uploadsDir = path.join(__dirname, 'uploads');
    const profilesDir = path.join(uploadsDir, 'profiles');
    const documentsDir = path.join(uploadsDir, 'documents');
    const logsDir = path.join(__dirname, 'logs');
    
    [uploadsDir, profilesDir, documentsDir, logsDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`✅ Created directory: ${dir}`);
        }
    });
    
    return { uploadsDir, profilesDir, documentsDir, logsDir };
};

const { uploadsDir } = createUploadDirectories();

// Serve static files
app.use('/uploads', express.static(uploadsDir));
app.use('/uploads/announcements', express.static(path.join(__dirname, 'uploads/announcements')));

// ============== MULTER CONFIGURATION ==============
const documentStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const documentsDir = path.join(__dirname, 'uploads', 'documents');
        cb(null, documentsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const fieldname = file.fieldname.replace(/[^a-zA-Z0-9]/g, '_');
        cb(null, fieldname + '-' + uniqueSuffix + ext);
    }
});

const uploadDocuments = multer({ 
    storage: documentStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only images and documents are allowed'));
        }
    }
});

// ============== AUTHENTICATION MIDDLEWARE ==============
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ 
            success: false,
            message: 'Access token required' 
        });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret_key_here', (err, user) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ 
                    success: false,
                    message: 'Token expired' 
                });
            }
            return res.status(403).json({ 
                success: false,
                message: 'Invalid or expired token' 
            });
        }
        req.user = user;
        req.userId = user.id;
        req.userRole = user.role;
        req.employeeId = user.employeeId;
        next();
    });
};

const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ 
            success: false,
            message: 'Admin access required' 
        });
    }
    next();
};

// ============== ROUTES ==============
// Public routes (no authentication needed)
app.use('/api/auth', authRoutes);

// Protected routes (authentication required)
app.use('/api/employees', authenticateToken, employeeRoutes);
app.use('/api/leaves', authenticateToken, leaveRoutes);
app.use('/api/attendance', authenticateToken, attendanceRoutes(supabase, authenticateToken, requireAdmin));
app.use('/api/salary', authenticateToken, salaryRoutes);
app.use('/api/notifications', authenticateToken, notificationRoutes);
app.use('/api/admin-updates', authenticateToken, adminUpdateRoutes);
app.use('/api/employee-updates', authenticateToken, employeeUpdateRoutes);
app.use('/api/update-responses', authenticateToken, updateResponseRoutes);
app.use('/api/notices', authenticateToken, noticeRoutes);
app.use('/api/announcements', authenticateToken, announcementRoutes);

// Make uploadDocuments available to routes
app.locals.uploadDocuments = uploadDocuments;

// ============== HEALTH CHECK ENDPOINTS ==============
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Server is healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        port: PORT,
        cors_enabled: true,
        allowed_origins: uniqueAllowedOrigins,
        features: {
            attendance_regularization: true,
            auto_close_sessions: true,
            cron_jobs_enabled: true
        }
    });
});

app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'Backend is working!',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        cors: {
            origins: uniqueAllowedOrigins,
            requestOrigin: req.headers.origin || 'No origin',
            allowedHeaders: 'Content-Type, Authorization, X-Requested-With, Accept, Origin, employee-id, X-Employee-Id'
        }
    });
});

app.get('/api/test-db', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('employees')
            .select('count', { count: 'exact', head: true });
        
        if (error) throw error;
        
        res.json({
            success: true,
            message: 'Supabase connected successfully!',
            database: 'Supabase',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Database connection error:', error);
        res.status(500).json({
            success: false,
            message: 'Supabase connection failed',
            error: error.message
        });
    }
});

// ============== CORS DEBUG ENDPOINT ==============
app.get('/api/cors-debug', (req, res) => {
    res.json({
        success: true,
        headers: req.headers,
        origin: req.headers.origin,
        method: req.method,
        allowed_origins: uniqueAllowedOrigins,
        cors_headers: {
            'Access-Control-Allow-Origin': res.getHeader('Access-Control-Allow-Origin'),
            'Access-Control-Allow-Methods': res.getHeader('Access-Control-Allow-Methods'),
            'Access-Control-Allow-Headers': res.getHeader('Access-Control-Allow-Headers')
        }
    });
});

// ============== ROOT ENDPOINT ==============
app.get('/', (req, res) => {
    res.json({
        name: 'Employee Management System API',
        version: '2.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        features: {
            attendance_regularization: true,
            auto_close_missed_clockouts: true,
            overtime_calculation: true,
            comp_off_management: true
        },
        endpoints: {
            health: '/api/health',
            test: '/api/test',
            testDb: '/api/test-db',
            corsDebug: '/api/cors-debug',
            auth: '/api/auth/*',
            employees: '/api/employees/*',
            leaves: '/api/leaves/*',
            attendance: '/api/attendance/*',
            salary: '/api/salary/*',
            notifications: '/api/notifications/*',
            adminUpdates: '/api/admin-updates/*',
            employeeUpdates: '/api/employee-updates/*',
            updateResponses: '/api/update-responses/*'
        }
    });
});

// ============== CRON JOBS ==============
console.log('\n' + '='.repeat(70));
console.log('⏰ SETTING UP CRON JOBS');
console.log('='.repeat(70));

// Function to log cron job activities
const logCronActivity = (type, message, duration = null) => {
    const logDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    
    const logEntry = {
        timestamp: new Date().toISOString(),
        type: type,
        message: message,
        duration: duration,
        environment: process.env.NODE_ENV || 'development'
    };
    
    fs.appendFileSync(
        path.join(logDir, 'cron-jobs.log'),
        JSON.stringify(logEntry) + '\n'
    );
};

// Run auto-close check every hour (at minute 0)
cron.schedule('0 * * * *', async () => {
    console.log('\n🕐 Running scheduled auto-close check...');
    const startTime = Date.now();
    try {
        const result = await attendanceController.autoCloseStaleSessions();
        const duration = Date.now() - startTime;
        console.log(`✅ Auto-close completed in ${duration}ms: ${result.closedCount} sessions closed`);
        
        if (isProduction || result.closedCount > 0) {
            logCronActivity('AUTO_CLOSE', `${result.closedCount} sessions closed`, duration);
        }
    } catch (error) {
        console.error('❌ Auto-close cron error:', error);
        logCronActivity('AUTO_CLOSE_ERROR', error.message);
    }
});

// Run end-of-day absent marking at midnight (23:59)
cron.schedule('59 23 * * *', async () => {
    console.log('\n🌙 Running end-of-day absent marking...');
    const startTime = Date.now();
    try {
        const result = await attendanceController.markAbsentAtDayEnd();
        const duration = Date.now() - startTime;
        console.log(`✅ Absent marking completed in ${duration}ms: ${result.message}`);
        logCronActivity('END_OF_DAY', result.message, duration);
    } catch (error) {
        console.error('❌ End-of-day marking error:', error);
        logCronActivity('END_OF_DAY_ERROR', error.message);
    }
});

// Run database cleanup weekly (Sunday at 2 AM)
cron.schedule('0 2 * * 0', async () => {
    console.log('\n🧹 Running weekly database cleanup...');
    const startTime = Date.now();
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const { count: sessionsCount, error: sessionError } = await supabase
            .from('attendance_sessions')
            .delete()
            .eq('is_active', false)
            .lt('clock_out_time', thirtyDaysAgo.toISOString())
            .select('count', { count: 'exact', head: true });
        
        if (sessionError) throw sessionError;
        
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        
        const { count: requestsCount, error: reqError } = await supabase
            .from('regularization_requests')
            .delete()
            .in('status', ['approved', 'rejected'])
            .lt('created_at', ninetyDaysAgo.toISOString())
            .select('count', { count: 'exact', head: true });
        
        if (reqError) throw reqError;
        
        const duration = Date.now() - startTime;
        console.log(`✅ Cleanup completed in ${duration}ms: ${sessionsCount || 0} sessions, ${requestsCount || 0} requests removed`);
        logCronActivity('WEEKLY_CLEANUP', `${sessionsCount || 0} sessions, ${requestsCount || 0} requests removed`, duration);
    } catch (error) {
        console.error('❌ Weekly cleanup error:', error);
        logCronActivity('WEEKLY_CLEANUP_ERROR', error.message);
    }
});

console.log('✅ Cron jobs configured:');
console.log('   - Hourly: Auto-close stale sessions');
console.log('   - Daily at 23:59: End-of-day absent marking');
console.log('   - Weekly on Sunday at 02:00: Database cleanup');

// ============== ERROR HANDLING MIDDLEWARE ==============
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route ${req.method} ${req.url} not found`,
        availableEndpoints: [
            '/api/health',
            '/api/test',
            '/api/test-db',
            '/api/cors-debug',
            '/api/auth/*',
            '/api/employees/*',
            '/api/leaves/*',
            '/api/attendance/*',
            '/api/salary/*',
            '/api/notifications/*',
            '/api/admin-updates/*',
            '/api/employee-updates/*',
            '/api/update-responses/*'
        ]
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('❌ Server error:', err.stack);
    
    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({
            success: false,
            message: 'CORS error: Origin not allowed',
            error: err.message,
            origin: req.headers.origin,
            allowedOrigins: uniqueAllowedOrigins
        });
    }
    
    if (err instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            message: 'File upload error',
            error: err.message
        });
    }
    
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            success: false,
            message: 'Invalid token',
            error: err.message
        });
    }
    
    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
            success: false,
            message: 'Token expired',
            error: err.message
        });
    }
    
    if (isProduction) {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        fs.appendFileSync(
            path.join(logDir, 'errors.log'),
            `${new Date().toISOString()} - ${err.stack}\n`
        );
    }
    
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// ============== START SERVER ==============
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(70));
    console.log(`🚀 SERVER STARTED SUCCESSFULLY`);
    console.log('='.repeat(70));
    console.log(`📡 Server running on: http://localhost:${PORT}`);
    console.log(`🌍 Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
    console.log(`🔗 Public URL: ${process.env.RENDER_EXTERNAL_URL || 'Not set'}`);
    console.log('='.repeat(70));
    console.log(`🔧 CORS Allowed Origins:`);
    uniqueAllowedOrigins.forEach(origin => {
        console.log(`   - ${origin}`);
    });
    console.log('='.repeat(70));
    console.log(`✨ Features enabled:`);
    console.log(`   - Attendance Regularization`);
    console.log(`   - Auto-close Missed Clock-outs`);
    console.log(`   - Overtime Calculation`);
    console.log(`   - Comp-off Management`);
    console.log(`   - Cron Jobs (Hourly/Daily/Weekly)`);
    console.log('='.repeat(70));
});

// Handle graceful shutdown
const gracefulShutdown = async () => {
    console.log('\n🛑 Received shutdown signal, closing server gracefully...');
    
    if (supabase && supabase.supabaseClient) {
        console.log('📡 Closing database connections...');
        console.log('✅ Database connections closed');
    }
    
    const logDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
        path.join(logDir, 'server.log'),
        `${new Date().toISOString()} - Server shutdown\n`
    );
    
    console.log('✅ Server shutdown complete');
    process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    console.error('Stack:', error.stack);
    
    if (isProduction) {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        fs.appendFileSync(
            path.join(logDir, 'errors.log'),
            `${new Date().toISOString()} - Uncaught Exception: ${error.stack}\n`
        );
    }
    
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    
    if (isProduction) {
        const logDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        fs.appendFileSync(
            path.join(logDir, 'errors.log'),
            `${new Date().toISOString()} - Unhandled Rejection: ${reason}\n`
        );
    }
    
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
});

// In server.js - Add temporary debug route
app.get('/api/debug/regularization-ids', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { data } = await supabase
            .from('regularization_requests')
            .select('id, status')
            .limit(10);
        
        res.json({
            success: true,
            ids: data.map(d => ({
                id: d.id,
                type: typeof d.id,
                string_version: String(d.id)
            }))
        });
    } catch (error) {
        res.json({ error: error.message });
    }
});

// Add this before your routes
app.get('/api/debug/routes', (req, res) => {
    const routes = [];
    
    // Function to extract routes from app
    function printRoutes(stack, basePath = '') {
        stack.forEach(layer => {
            if (layer.route) {
                const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
                routes.push({
                    path: basePath + layer.route.path,
                    methods: methods
                });
            } else if (layer.name === 'router' && layer.handle.stack) {
                printRoutes(layer.handle.stack, basePath + (layer.regexp.source.replace(/\\/g, '').replace(/\^|\?/g, '').replace(/\//g, '')));
            }
        });
    }
    
    printRoutes(app._router.stack);
    res.json({
        success: true,
        routes: routes.filter(r => r.path.includes('regularization'))
    });
});

// Add a test endpoint to check database connectivity
app.get('/api/test-supabase', async (req, res) => {
    try {
        const startTime = Date.now();
        const { data, error } = await supabase
            .from('regularization_requests')
            .select('count', { count: 'exact', head: true });
        
        const duration = Date.now() - startTime;
        
        if (error) throw error;
        
        res.json({
            success: true,
            message: 'Supabase connected',
            response_time_ms: duration,
            count: data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = app;