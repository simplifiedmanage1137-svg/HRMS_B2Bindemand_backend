const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ success: false, message: 'Token expired', code: 'TOKEN_EXPIRED' });
            }
            return res.status(401).json({ success: false, message: 'Invalid token' });
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
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    next();
};

const isOwnDataOrAdmin = (req, res, next) => {
    const userRole = req.user?.role;
    const userEmployeeId = req.user?.employeeId;

    let requestedEmployeeId = req.params.employee_id || req.body.employee_id || req.query.employee_id;

    if (userRole === 'admin') return next();
    if (userEmployeeId === requestedEmployeeId) return next();

    if (!requestedEmployeeId) {
        if (req.method === 'POST' && !req.body.employee_id) {
            req.body.employee_id = userEmployeeId;
        }
        return next();
    }

    return res.status(403).json({ success: false, message: 'Access denied: You can only access your own data' });
};

module.exports = { verifyToken, isAdmin, isOwnDataOrAdmin };
