// backend/routes/ratingRoutes.js
const express = require('express');
const router = express.Router();
const ratingController = require('../controllers/ratingController');

// ✅ No special middleware - let the controller handle authorization
module.exports = (authenticateToken, requireAdmin) => {
    // Team Leader/Manager routes (authorization handled in controller)
    router.get('/team', authenticateToken, ratingController.getTeamForRating);
    router.post('/submit', authenticateToken, ratingController.submitRating);
    
    // Employee routes
    router.get('/employee/:employee_id/history', authenticateToken, ratingController.getEmployeeRatingHistory);
    
    // Admin routes
    router.get('/all', authenticateToken, requireAdmin, ratingController.getAllRatings);
    router.post('/admin-rate', authenticateToken, requireAdmin, ratingController.adminRateEmployee);
    
    return router;
};