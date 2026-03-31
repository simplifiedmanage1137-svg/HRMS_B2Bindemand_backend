const mongoose = require('mongoose');

const updateRequestSchema = new mongoose.Schema({
  employeeId: {
    type: String,
    required: true,
    ref: 'Employee'
  },
  adminId: {
    type: String,
    required: true
  },
  requestedFields: {
    type: [String], // ['personal', 'contact', 'bank', 'documents']
    default: []
  },
  status: {
    type: String,
    enum: ['pending', 'in-progress', 'completed', 'rejected'],
    default: 'pending'
  },
  employeeData: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('UpdateRequest', updateRequestSchema);