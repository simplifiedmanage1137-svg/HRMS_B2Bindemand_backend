const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

// Login route
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        console.log('🔐 Login attempt for email:', email);

        // Validate input
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        // For admin login with new credentials
        if (email === 'hr@b2bindemand.com' && password === 'Hr3007') {
            const token = jwt.sign(
                { 
                    id: 1, 
                    email, 
                    role: 'admin',
                    employeeId: 'HR001'
                },
                JWT_SECRET,
                { expiresIn: '7d' }
            );
            
            console.log('✅ Admin login successful for hr@b2bindemand.com');
            
            return res.json({
                success: true,
                token,
                user: {
                    id: 1,
                    email,
                    role: 'admin',
                    employeeId: 'HR001',
                    firstName: 'HR',
                    lastName: 'Admin',
                    department: 'Human Resources',
                    designation: 'HR Manager'
                }
            });
        }

        // For employee login - handle both email formats
        let employeeId = null;
        let queryEmail = email;
        let user = null;

        // Check if email is in emp_ format (emp_B2B251201@ems.com)
        if (email.startsWith('emp_') && email.endsWith('@ems.com')) {
            employeeId = email.replace('emp_', '').replace('@ems.com', '');
            console.log('🔍 Extracted employee ID from email:', employeeId);
            
            // Try to find by employee_id first
            const { data: userById, error: idError } = await supabase
                .from('employees')
                .select('*')
                .eq('employee_id', employeeId);

            if (!idError && userById && userById.length > 0) {
                user = userById[0];
                console.log('✅ User found by employee_id:', user.employee_id);
            }
        }

        // If not found by employee_id, try by email
        if (!user) {
            console.log('🔍 Trying to find user by email:', queryEmail);
            const { data: users, error } = await supabase
                .from('employees')
                .select('*')
                .eq('email', queryEmail);

            if (error) {
                console.error('❌ Database error:', error);
                throw error;
            }

            if (users && users.length > 0) {
                user = users[0];
                console.log('✅ User found by email:', user.email);
            }
        }

        // If user not found by any method
        if (!user) {
            console.log('❌ User not found');
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        console.log('📊 User details:', { 
            id: user.id, 
            email: user.email, 
            employeeId: user.employee_id 
        });

        // For demo purposes, accept default password
        const isValidPassword = password === 'Welcome@123' || 
                               password === user.employee_id?.toLowerCase();

        if (!isValidPassword) {
            console.log('❌ Invalid password for user:', email);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Check if employee is active (if is_active column exists)
        if (user.is_active === false) {
            console.log('❌ Inactive employee:', email);
            return res.status(403).json({
                success: false,
                message: 'Your account is deactivated. Please contact admin.'
            });
        }

        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: 'employee',
                employeeId: user.employee_id 
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        console.log('✅ Employee login successful:', email);

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                role: 'employee',
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
        res.status(500).json({
            success: false,
            message: 'Server error during login',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Register route (for creating new employee accounts)
router.post('/register', async (req, res) => {
    try {
        const { employee_id, email, password, first_name, last_name, department, designation } = req.body;

        // Validate required fields
        if (!employee_id || !email || !first_name || !last_name) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // Check if user already exists
        const { data: existing, error: checkError } = await supabase
            .from('employees')
            .select('id')
            .or(`email.eq.${email},employee_id.eq.${employee_id}`);

        if (checkError) throw checkError;

        if (existing && existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'User with this email or employee ID already exists'
            });
        }

        // Create new employee
        const { data: newUser, error: insertError } = await supabase
            .from('employees')
            .insert([{
                employee_id,
                email,
                first_name,
                last_name,
                department: department || null,
                designation: designation || null,
                password: password || 'Welcome@123', // In production, hash this!
                role: 'employee',
                is_active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }])
            .select();

        if (insertError) {
            console.error('❌ Insert error:', insertError);
            throw insertError;
        }

        console.log('✅ Employee registered successfully:', employee_id);

        res.status(201).json({
            success: true,
            message: 'Employee registered successfully',
            user: {
                id: newUser[0].id,
                employeeId: newUser[0].employee_id,
                email: newUser[0].email,
                firstName: newUser[0].first_name,
                lastName: newUser[0].last_name
            }
        });

    } catch (error) {
        console.error('❌ Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during registration',
            error: error.message
        });
    }
});

// Verify token route
router.post('/verify', async (req, res) => {
    try {
        const token = req.headers['authorization']?.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);

        // Get fresh user data
        const { data: user, error } = await supabase
            .from('employees')
            .select('*')
            .eq('id', decoded.id)
            .single();

        if (error || !user) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }

        // Check if user is still active
        if (user.is_active === false) {
            return res.status(403).json({
                success: false,
                message: 'Account is deactivated'
            });
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                role: decoded.role,
                employeeId: user.employee_id,
                firstName: user.first_name,
                lastName: user.last_name,
                department: user.department,
                designation: user.designation,
                profile_image: user.profile_image
            }
        });

    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired'
            });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token'
            });
        }
        
        console.error('❌ Token verification error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Logout route (optional - client just discards token)
router.post('/logout', (req, res) => {
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});

// Change password route
router.post('/change-password', async (req, res) => {
    try {
        const token = req.headers['authorization']?.split(' ')[1];
        const { currentPassword, newPassword } = req.body;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Current password and new password are required'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'New password must be at least 6 characters long'
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);

        // Get user
        const { data: user, error } = await supabase
            .from('employees')
            .select('*')
            .eq('id', decoded.id)
            .single();

        if (error || !user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Verify current password (for demo, using simple check)
        const isValidCurrent = currentPassword === 'Welcome@123' || 
                              currentPassword === user.employee_id?.toLowerCase();

        if (!isValidCurrent) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        // Update password (in production, hash this!)
        const { error: updateError } = await supabase
            .from('employees')
            .update({
                password: newPassword,
                updated_at: new Date().toISOString()
            })
            .eq('id', decoded.id);

        if (updateError) throw updateError;

        console.log('✅ Password changed successfully for user:', user.employee_id);

        res.json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired'
            });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token'
            });
        }
        
        console.error('❌ Password change error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Forgot password route (request password reset)
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email is required'
            });
        }

        // Check if user exists
        const { data: user, error } = await supabase
            .from('employees')
            .select('id, employee_id, email, first_name')
            .eq('email', email)
            .single();

        if (error || !user) {
            // Don't reveal that user doesn't exist for security
            return res.json({
                success: true,
                message: 'If your email exists in our system, you will receive a password reset link'
            });
        }

        // Generate reset token (valid for 1 hour)
        const resetToken = jwt.sign(
            { 
                id: user.id,
                email: user.email,
                purpose: 'password_reset'
            },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        // In production, send email with reset link
        // For demo, just return the token
        console.log('📧 Password reset token for', email, ':', resetToken);

        res.json({
            success: true,
            message: 'If your email exists in our system, you will receive a password reset link',
            // Only include reset token in development
            ...(process.env.NODE_ENV === 'development' && { resetToken })
        });

    } catch (error) {
        console.error('❌ Forgot password error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// Reset password with token
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Token and new password are required'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'New password must be at least 6 characters long'
            });
        }

        // Verify token
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }

        // Check if token is for password reset
        if (decoded.purpose !== 'password_reset') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token purpose'
            });
        }

        // Update password
        const { error: updateError } = await supabase
            .from('employees')
            .update({
                password: newPassword, // In production, hash this!
                updated_at: new Date().toISOString()
            })
            .eq('id', decoded.id);

        if (updateError) throw updateError;

        console.log('✅ Password reset successfully for user ID:', decoded.id);

        res.json({
            success: true,
            message: 'Password reset successfully'
        });

    } catch (error) {
        console.error('❌ Reset password error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

module.exports = router;