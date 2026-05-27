const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || JWT_SECRET + '_refresh';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

function generateTokens(payload) {
    const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
    const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
    return { accessToken, refreshToken };
}

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }

        // Admin hardcoded login
        if (email === 'hr@b2bindemand.com' && password === 'Hr3007') {
            const payload = { id: 1, email, role: 'admin', employeeId: 'HR001' };
            const { accessToken, refreshToken } = generateTokens(payload);
            return res.json({
                success: true,
                token: accessToken,
                refreshToken,
                user: { id: 1, email, role: 'admin', employeeId: 'HR001', firstName: 'HR', lastName: 'Admin', department: 'Human Resources', designation: 'HR Manager' }
            });
        }

        // Find employee by email or emp_ format
        let user = null;

        if (email.startsWith('emp_') && email.endsWith('@ems.com')) {
            const employeeId = email.replace('emp_', '').replace('@ems.com', '');
            const { data } = await supabase.from('employees').select('*').eq('employee_id', employeeId).maybeSingle();
            user = data;
        }

        if (!user) {
            const { data, error } = await supabase.from('employees').select('*').eq('email', email.toLowerCase().trim()).maybeSingle();
            if (error) throw error;
            user = data;
        }

        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        console.log('📊 User details:', { 
            id: user.id, 
            email: user.email, 
            employeeId: user.employee_id 
        });

        // Verify password:
        // - DB always has bcrypt hash (either of Welcome@123 or user-set password)
        // - Just do bcrypt compare
        let isValidPassword = false;

        if (!user.password) {
            // No password in DB — allow Welcome@123 as default
            isValidPassword = (password === 'Welcome@123');
        } else {
            // Always bcrypt compare (covers both default hashed Welcome@123 and user-set passwords)
            isValidPassword = await bcrypt.compare(password, user.password);
        }

        if (!isValidPassword) {
            console.log('❌ Invalid password for user:', email);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Check if employee is active (if is_active column exists)
        if (user.is_active === false) {
            return res.status(403).json({ success: false, message: 'Your account is deactivated. Please contact admin.' });
        }

        // Verify password with bcrypt, fallback to plain text for legacy
        let isValid = false;
        if (user.password) {
            try {
                isValid = await bcrypt.compare(password, user.password);
            } catch {
                isValid = password === user.password;
            }
        }

        // Legacy fallback: allow default passwords if no hashed password set
        if (!isValid && (!user.password || user.password === 'Welcome@123' || user.password === user.employee_id?.toLowerCase())) {
            isValid = password === 'Welcome@123' || password === user.employee_id?.toLowerCase();
        }

        if (!isValid) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        const payload = { id: user.id, email: user.email, role: user.role || 'employee', employeeId: user.employee_id };
        const { accessToken, refreshToken } = generateTokens(payload);

        return res.json({
            success: true,
            token: accessToken,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                role: user.role || 'employee',
                employeeId: user.employee_id,
                firstName: user.first_name,
                lastName: user.last_name,
                department: user.department,
                designation: user.designation,
                profile_image: user.profile_image
            }
        });

    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ success: false, message: 'Server error during login', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
});

// Refresh token
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(401).json({ success: false, message: 'Refresh token required' });
        }

        let decoded;
        try {
            decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
        } catch {
            return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
        }

        // Get fresh user data
        let user = null;
        if (decoded.employeeId === 'HR001') {
            const { accessToken: newAccess, refreshToken: newRefresh } = generateTokens({ id: decoded.id, email: decoded.email, role: decoded.role, employeeId: decoded.employeeId });
            return res.json({ success: true, token: newAccess, refreshToken: newRefresh });
        }

        const { data, error } = await supabase.from('employees').select('id, email, role, employee_id, first_name, last_name, department, designation, profile_image, is_active').eq('id', decoded.id).maybeSingle();
        if (error || !data) return res.status(401).json({ success: false, message: 'User not found' });
        if (data.is_active === false) return res.status(403).json({ success: false, message: 'Account deactivated' });

        user = data;
        const payload = { id: user.id, email: user.email, role: user.role || 'employee', employeeId: user.employee_id };
        const { accessToken, refreshToken: newRefreshToken } = generateTokens(payload);

        return res.json({
            success: true,
            token: accessToken,
            refreshToken: newRefreshToken,
            user: {
                id: user.id,
                email: user.email,
                role: user.role || 'employee',
                employeeId: user.employee_id,
                firstName: user.first_name,
                lastName: user.last_name,
                department: user.department,
                designation: user.designation,
                profile_image: user.profile_image
            }
        });

    } catch (error) {
        console.error('❌ Refresh error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Verify token & return fresh user data
router.post('/verify', async (req, res) => {
    try {
        const token = req.headers['authorization']?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'No token provided' });

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            if (err.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: 'Token expired', code: 'TOKEN_EXPIRED' });
            return res.status(401).json({ success: false, message: 'Invalid token' });
        }

        if (decoded.employeeId === 'HR001') {
            return res.json({ success: true, user: { id: decoded.id, email: decoded.email, role: 'admin', employeeId: 'HR001', firstName: 'HR', lastName: 'Admin' } });
        }

        const { data: user, error } = await supabase.from('employees').select('id, email, role, employee_id, first_name, last_name, department, designation, profile_image, is_active').eq('id', decoded.id).maybeSingle();

        if (error || !user) return res.status(401).json({ success: false, message: 'User not found' });
        if (user.is_active === false) return res.status(403).json({ success: false, message: 'Account deactivated' });

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                role: user.role || decoded.role || 'employee',
                employeeId: user.employee_id,
                firstName: user.first_name,
                lastName: user.last_name,
                department: user.department,
                designation: user.designation,
                profile_image: user.profile_image
            }
        });

    } catch (error) {
        console.error('❌ Verify error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Register
router.post('/register', async (req, res) => {
    try {
        const { employee_id, email, password, first_name, last_name, department, designation } = req.body;

        if (!employee_id || !email || !first_name || !last_name) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const { data: existing } = await supabase.from('employees').select('id').or(`email.eq.${email},employee_id.eq.${employee_id}`);
        if (existing && existing.length > 0) {
            return res.status(400).json({ success: false, message: 'User with this email or employee ID already exists' });
        }

        const hashedPassword = await bcrypt.hash(password || 'Welcome@123', 10);

        const { data: newUser, error } = await supabase.from('employees').insert([{
            employee_id, email, first_name, last_name,
            department: department || null,
            designation: designation || null,
            password: hashedPassword,
            role: 'employee',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }]).select();

        if (error) throw error;

        res.status(201).json({ success: true, message: 'Employee registered successfully', user: { id: newUser[0].id, employeeId: newUser[0].employee_id, email: newUser[0].email } });

    } catch (error) {
        console.error('❌ Registration error:', error);
        res.status(500).json({ success: false, message: 'Server error during registration', error: error.message });
    }
});

// Logout
router.post('/logout', (req, res) => {
    res.json({ success: true, message: 'Logged out successfully' });
});

// Change password
router.post('/change-password', async (req, res) => {
    try {
        const token = req.headers['authorization']?.split(' ')[1];
        const { currentPassword, newPassword } = req.body;

        if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
        if (!currentPassword || !newPassword) return res.status(400).json({ success: false, message: 'Both passwords are required' });
        if (newPassword.length < 6) return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });

        const decoded = jwt.verify(token, JWT_SECRET);
        const { data: user, error } = await supabase.from('employees').select('*').eq('id', decoded.id).maybeSingle();
        if (error || !user) return res.status(404).json({ success: false, message: 'User not found' });

        let isValid = false;
        if (user.password) {
            try { isValid = await bcrypt.compare(currentPassword, user.password); } catch { isValid = currentPassword === user.password; }
        }
        if (!isValid) isValid = currentPassword === 'Welcome@123' || currentPassword === user.employee_id?.toLowerCase();

        if (!isValid) return res.status(401).json({ success: false, message: 'Current password is incorrect' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const { error: updateError } = await supabase.from('employees').update({ password: hashedPassword, updated_at: new Date().toISOString() }).eq('id', decoded.id);
        if (updateError) throw updateError;

        res.json({ success: true, message: 'Password changed successfully' });

    } catch (error) {
        if (error.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: 'Token expired' });
        if (error.name === 'JsonWebTokenError') return res.status(401).json({ success: false, message: 'Invalid token' });
        console.error('❌ Change password error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Forgot password
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

        const { data: user } = await supabase.from('employees').select('id, email, first_name').eq('email', email).maybeSingle();

        // Always return same message for security
        if (!user) return res.json({ success: true, message: 'If your email exists, you will receive a reset link' });

        const resetToken = jwt.sign({ id: user.id, email: user.email, purpose: 'password_reset' }, JWT_SECRET, { expiresIn: '1h' });
        console.log('📧 Password reset token for', email, ':', resetToken);

        res.json({
            success: true,
            message: 'If your email exists, you will receive a reset link',
            ...(process.env.NODE_ENV === 'development' && { resetToken })
        });

    } catch (error) {
        console.error('❌ Forgot password error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Reset password
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.status(400).json({ success: false, message: 'Token and new password are required' });
        if (newPassword.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

        let decoded;
        try { decoded = jwt.verify(token, JWT_SECRET); } catch {
            return res.status(401).json({ success: false, message: 'Invalid or expired token' });
        }

        if (decoded.purpose !== 'password_reset') return res.status(401).json({ success: false, message: 'Invalid token purpose' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const { error } = await supabase.from('employees').update({ password: hashedPassword, updated_at: new Date().toISOString() }).eq('id', decoded.id);
        if (error) throw error;

        res.json({ success: true, message: 'Password reset successfully' });

    } catch (error) {
        console.error('❌ Reset password error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Direct password reset by email (no token — employee sets new password from login page)
router.post('/reset-password-direct', async (req, res) => {
    try {
        const { email, newPassword } = req.body;

        if (!email || !newPassword) {
            return res.status(400).json({ success: false, message: 'Email and new password are required' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
        }

        const { data: employee, error } = await supabase
            .from('employees')
            .select('employee_id, email')
            .eq('email', email.toLowerCase().trim())
            .maybeSingle();

        if (error) throw error;
        if (!employee) {
            return res.status(404).json({ success: false, message: 'No account found with this email address' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        const { error: updateError } = await supabase
            .from('employees')
            .update({ password: hashedPassword })
            .eq('email', email.toLowerCase().trim());

        if (updateError) throw updateError;

        console.log('✅ Password reset for:', employee.employee_id);
        res.json({ success: true, message: 'Password updated successfully. You can now login with your new password.' });

    } catch (error) {
        console.error('❌ Reset password error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

module.exports = router;
