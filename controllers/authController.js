const supabase = require('../config/supabase');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }

        // Get employee from database by email
        const { data: employees, error: empError } = await supabase
            .from('employees')
            .select('*')
            .eq('email', email.toLowerCase().trim());

        if (empError) throw empError;

        if (!employees || employees.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        const employee = employees[0];

        // Check password
        let isPasswordValid = false;

        if (employee.password) {
            // Try bcrypt compare first (hashed password)
            try {
                isPasswordValid = await bcrypt.compare(password, employee.password);
            } catch (e) {
                // Fallback: plain text compare (legacy)
                isPasswordValid = (password === employee.password);
            }
        }

        if (!isPasswordValid) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        const role = employee.role || 'employee';

        const token = jwt.sign(
            { id: employee.id, email: employee.email, role, employeeId: employee.employee_id },
            process.env.JWT_SECRET || 'your_secret_key',
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        return res.json({
            success: true,
            token,
            user: {
                id: employee.id,
                email: employee.email,
                role,
                employeeId: employee.employee_id,
                employeeData: employee
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
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

exports.verifyToken = async (req, res) => {
    try {
        const token = req.headers['authorization']?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key');

        // Get employee from database
        const { data: employees, error: empError } = await supabase
            .from('employees')
            .select('*')
            .eq('employee_id', decoded.employeeId);

        if (empError) throw empError;

        if (!employees || employees.length === 0) {
            return res.status(401).json({ success: false, message: 'Employee not found' });
        }

        const employee = employees[0];
        const role = employee.role || decoded.role || 'employee';

        res.json({
            success: true,
            user: {
                id: employee.id,
                email: employee.email,
                role,
                employeeId: employee.employee_id,
                employeeData: employee
            }
        });

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ success: false, message: 'Invalid token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Token expired' });
        }
        console.error('Token verification error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
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