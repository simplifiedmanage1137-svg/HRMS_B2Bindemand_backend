// backend/routes/ratingRoutes.js
const express = require('express');
const router = express.Router();
const ratingController = require('../controllers/ratingController');

module.exports = (authenticateToken, requireAdmin) => {
    // Manager routes
    router.get('/team', authenticateToken, ratingController.getTeamForRating);
    router.post('/submit', authenticateToken, ratingController.submitRating);
    
    // Employee routes
    router.get('/employee/:employee_id/history', authenticateToken, ratingController.getEmployeeRatingHistory);
    
    // Admin routes
    router.get('/all', authenticateToken, requireAdmin, ratingController.getAllRatings);
    router.post('/admin-rate', authenticateToken, requireAdmin, ratingController.adminRateEmployee);
    
    return router;
};