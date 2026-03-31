const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create upload directories if they don't exist
const createDir = (dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};

createDir('uploads/profiles');
createDir('uploads/resumes');
createDir('uploads/documents');

// Configure storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        let uploadPath = 'uploads/documents/';
        
        // Determine folder based on file type
        if (file.fieldname === 'profile_image') {
            uploadPath = 'uploads/profiles/';
        } else if (file.fieldname === 'appointment_letter' || 
                   file.fieldname === 'offer_letter' || 
                   file.fieldname === 'contract_document' ||
                   file.fieldname === 'relieving_letter' ||    // New field
                   file.fieldname === 'salary_slip') {        // New field
            uploadPath = 'uploads/documents/';
        }
        
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // Create unique filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const filename = file.fieldname + '-' + uniqueSuffix + ext;
        cb(null, filename);
    }
});

// File filter
const fileFilter = (req, file, cb) => {
    // Allowed file types
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Only images, PDF, and DOC files are allowed'));
    }
};

// Create multer upload instance
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: fileFilter
});

module.exports = upload;