const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ 
            success: false,
            message: 'Access token required' 
        });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ 
                success: false,
                message: 'Invalid or expired token' 
            });
        }
        
        req.user = {
            id: decoded.id,
            employeeId: decoded.employeeId,
            role: decoded.role,
            email: decoded.email
        };
        
        next();
    });
};

const isAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ 
            success: false,
            message: 'Admin access required' 
        });
    }
    next();
};

const isOwnDataOrAdmin = (req, res, next) => {
    const userRole = req.user?.role;
    const userEmployeeId = req.user?.employeeId;
    
    // Check params first (for GET requests with employee_id in URL)
    let requestedEmployeeId = req.params.employee_id;
    
    // If not in params, check body (for POST requests)
    if (!requestedEmployeeId && req.body.employee_id) {
        requestedEmployeeId = req.body.employee_id;
    }
    
    // If still not found, check query params
    if (!requestedEmployeeId && req.query.employee_id) {
        requestedEmployeeId = req.query.employee_id;
    }

    if (userRole === 'admin') {
        return next();
    }

    if (userEmployeeId === requestedEmployeeId) {
        return next();
    }

    // If no employee_id is specified, assume user is accessing their own data
    if (!requestedEmployeeId) {
        // For POST requests like generate salary slip, attach user's employee_id to body
        if (req.method === 'POST' && !req.body.employee_id) {
            req.body.employee_id = userEmployeeId;
        }
        return next();
    }

    return res.status(403).json({ 
        success: false,
        message: 'Access denied: You can only access your own data' 
    });
};

module.exports = { verifyToken, isAdmin, isOwnDataOrAdmin };