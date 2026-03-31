const supabase = require('../config/supabase');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        
        console.log('Login attempt for email:', email);
        console.log('Request body:', req.body);

        // Check if Supabase connection works
        try {
            const { error } = await supabase.from('users').select('count', { count: 'exact', head: true });
            if (error) throw error;
            console.log('Supabase connection OK');
        } catch (dbError) {
            console.error('Supabase connection error:', dbError);
            return res.status(500).json({ message: 'Database connection error' });
        }

        // Get user from database
        const { data: users, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email);

        if (userError) throw userError;

        console.log('Users found:', users?.length || 0);

        if (!users || users.length === 0) {
            console.log('User not found:', email);
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        const user = users[0];
        console.log('User found:', user.email, 'Role:', user.role);
        
        // Simple password check for testing
        if (password === 'admin123' || password === 'Welcome@123') {
            
            // Get employee details if user is an employee
            let employeeData = null;
            if (user.role === 'employee') {
                const { data: employees, error: empError } = await supabase
                    .from('employees')
                    .select('*')
                    .eq('employee_id', user.employee_id);

                if (empError) throw empError;

                if (employees && employees.length > 0) {
                    employeeData = employees[0];
                }
            }

            // Generate JWT token
            const token = jwt.sign(
                { 
                    id: user.id, 
                    email: user.email,
                    role: user.role,
                    employeeId: user.employee_id 
                },
                process.env.JWT_SECRET || 'your_secret_key',
                { expiresIn: '24h' }
            );

            console.log('Login successful for:', email);

            return res.json({
                success: true,
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    role: user.role,
                    employeeId: user.employee_id,
                    employeeData: employeeData
                }
            });
        } else {
            console.log('Invalid password for user:', email);
            return res.status(401).json({ message: 'Invalid email or password' });
        }

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.register = async (req, res) => {
    try {
        const { email, password, employeeId, role = 'employee' } = req.body;
        
        // Check if user already exists
        const { data: existing, error: checkError } = await supabase
            .from('users')
            .select('*')
            .or(`email.eq.${email},employee_id.eq.${employeeId}`);

        if (checkError) throw checkError;

        if (existing && existing.length > 0) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        // Insert user
        const { data, error } = await supabase
            .from('users')
            .insert([{
                employee_id: employeeId,
                email: email,
                password: hashedPassword,
                role: role
            }])
            .select();

        if (error) throw error;

        res.status(201).json({ 
            success: true,
            message: 'User created successfully',
            userId: data[0].id 
        });
        
    } catch (error) {
        console.error('Register error:', error);
        
        // Handle duplicate key error
        if (error.code === '23505') {
            return res.status(400).json({ 
                message: 'User with this email or employee ID already exists' 
            });
        }
        
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Verify token and return user data
exports.verifyToken = async (req, res) => {
    try {
        // Get token from header
        const token = req.headers['authorization']?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'No token provided' 
            });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key');
        
        // Get user from database
        const { data: users, error: userError } = await supabase
            .from('users')
            .select('id, employee_id, email, role')
            .eq('id', decoded.id);

        if (userError) throw userError;

        if (!users || users.length === 0) {
            return res.status(401).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        const user = users[0];

        // Get employee details if user is an employee
        let employeeData = null;
        if (user.role === 'employee') {
            const { data: employees, error: empError } = await supabase
                .from('employees')
                .select('*')
                .eq('employee_id', user.employee_id);

            if (empError) throw empError;

            if (employees && employees.length > 0) {
                employeeData = employees[0];
            }
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                employeeId: user.employee_id,
                employeeData: employeeData
            }
        });

    } catch (error) {
        console.error('Token verification error:', error);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid token' 
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Token expired' 
            });
        }

        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
};

// Optional: Password reset request
exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        // Check if user exists
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email);

        if (error) throw error;

        if (!users || users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User with this email not found'
            });
        }

        // Generate reset token (valid for 1 hour)
        const resetToken = jwt.sign(
            { email },
            process.env.JWT_SECRET || 'your_secret_key',
            { expiresIn: '1h' }
        );

        // Here you would typically send an email with the reset link
        // For now, just return the token (in production, never do this!)
        
        res.json({
            success: true,
            message: 'Password reset link sent to email',
            resetToken: process.env.NODE_ENV === 'development' ? resetToken : undefined
        });

    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// Optional: Reset password with token
exports.resetPassword = async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key');

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password
        const { error } = await supabase
            .from('users')
            .update({ password: hashedPassword })
            .eq('email', decoded.email);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Password reset successful'
        });

    } catch (error) {
        console.error('Reset password error:', error);

        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// Optional: Change password (when logged in)
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user?.id; // Assuming you have auth middleware that sets req.user

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        // Get user with current password
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId);

        if (error) throw error;

        if (!users || users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const user = users[0];

        // Verify current password (if using hashed passwords)
        // Note: Your current setup uses plain text for testing
        // If you switch to hashed passwords, uncomment this:
        /*
        const isValid = await bcrypt.compare(currentPassword, user.password);
        if (!isValid) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }
        */

        // For now, simple check
        if (currentPassword !== 'admin123' && currentPassword !== 'Welcome@123') {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password
        const { error: updateError } = await supabase
            .from('users')
            .update({ password: hashedPassword })
            .eq('id', userId);

        if (updateError) throw updateError;

        res.json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};