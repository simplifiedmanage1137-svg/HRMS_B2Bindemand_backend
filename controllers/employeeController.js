const supabase = require('../config/supabase');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const EmployeeService = require('../services/employeeService');

// Generate Employee ID with 2-digit sequence based on joining date
const generateEmployeeIdBasedOnJoiningDate = async (joiningDate) => {
    const date = new Date(joiningDate);
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');

    try {
        console.log('Generating employee ID for joining date:', joiningDate);
        console.log('Year:', year, 'Month:', month);

        // Get all employees with same year/month prefix
        const { data: employees, error } = await supabase
            .from('employees')
            .select('employee_id')
            .like('employee_id', `B2B${year}${month}%`)
            .order('employee_id', { ascending: false });

        if (error) throw error;

        let nextSequence = 1;

        if (employees && employees.length > 0) {
            // Extract the last 2 digits from the existing IDs
            const sequences = employees.map(emp => {
                const id = emp.employee_id;
                // Extract last 2 characters (sequence)
                const seqStr = id.slice(-2);
                const seq = parseInt(seqStr, 10);
                return isNaN(seq) ? 0 : seq;
            });

            const maxSequence = Math.max(...sequences);
            nextSequence = maxSequence + 1;
            console.log('Last sequence found:', maxSequence, 'Next sequence:', nextSequence);
        } else {
            console.log('No existing employees for this month, starting with sequence 01');
        }

        // Ensure sequence doesn't exceed 99
        if (nextSequence > 99) {
            throw new Error('Maximum employees for this month reached (99)');
        }

        // Format sequence as 2 digits with leading zero
        const sequence = nextSequence.toString().padStart(2, '0');
        const employeeId = `B2B${year}${month}${sequence}`;

        // Double-check if this ID already exists
        const { data: existing, error: checkError } = await supabase
            .from('employees')
            .select('employee_id')
            .eq('employee_id', employeeId);

        if (checkError) throw checkError;

        if (existing && existing.length > 0) {
            console.log('Generated ID already exists, trying next sequence');
            // If it exists, try the next number recursively
            return await generateEmployeeIdBasedOnJoiningDate(joiningDate);
        }

        console.log('Generated Employee ID:', {
            joiningDate,
            year,
            month,
            nextSequence,
            sequence,
            employeeId
        });

        return employeeId;
    } catch (error) {
        console.error('Error generating employee ID:', error);
        // Fallback with timestamp to ensure uniqueness
        const timestamp = Date.now().toString().slice(-4);
        const fallbackSeq = timestamp.slice(-2);
        return `B2B${year}${month}${fallbackSeq}`;
    }
};

// Also fix the other generateEmployeeId function if it exists
const generateEmployeeId = async () => {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');

    try {
        // Get count of employees joined THIS MONTH
        const { count, error } = await supabase
            .from('employees')
            .select('*', { count: 'exact', head: true })
            .gte('joining_date', `${date.getFullYear()}-${month}-01`)
            .lt('joining_date', `${date.getFullYear()}-${String(date.getMonth() + 2).padStart(2, '0')}-01`);

        if (error) throw error;

        // Get the sequence number for this month (add 1 to count)
        const sequence = (count + 1).toString().padStart(2, '0'); // Changed from 3 to 2
        const employeeId = `B2B${year}${month}${sequence}`;

        console.log('Generated Employee ID:', {
            year,
            month,
            count,
            sequence,
            employeeId
        });

        return employeeId;
    } catch (error) {
        console.error('Error generating employee ID:', error);
        // Fallback with random sequence if error
        const randomSeq = Math.floor(Math.random() * 90 + 10).toString().padStart(2, '0'); // Changed from 3 to 2
        return `B2B${year}${month}${randomSeq}`;
    }
};

// Create new employee
exports.createEmployee = async (req, res) => {
    try {
        console.log('='.repeat(50));
        console.log('CREATE EMPLOYEE REQUEST RECEIVED');
        console.log('Request Body:', JSON.stringify(req.body, null, 2));
        console.log('='.repeat(50));

        const {
            first_name,
            middle_name,
            last_name,
            dob,
            position,
            joining_date,
            address,
            department,
            reporting_manager,
            employment_type,
            salary,
            emergency_contact,
            shift_timing,
            contract_policy
        } = req.body;

        // Validate required fields
        const requiredFields = {
            first_name,
            last_name,
            dob,
            position,
            joining_date,
            address,
            department,
            salary
        };

        const missingFields = [];
        for (const [field, value] of Object.entries(requiredFields)) {
            if (!value) {
                missingFields.push(field);
            }
        }

        if (missingFields.length > 0) {
            console.log('Missing required fields:', missingFields);
            return res.status(400).json({
                success: false,
                message: 'Missing required fields',
                missingFields: missingFields
            });
        }

        // Format dates
        const formatDateForPostgres = (dateStr) => {
            if (!dateStr) return null;
            if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                return dateStr;
            }
            if (dateStr.includes('/')) {
                const [month, day, year] = dateStr.split('/');
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }
            return dateStr;
        };

        const formattedDob = formatDateForPostgres(dob);
        const formattedJoiningDate = formatDateForPostgres(joining_date);

        console.log('Formatted Dates:', {
            dob: formattedDob,
            joining_date: formattedJoiningDate
        });

        // Generate employee ID based on JOINING DATE
        const employeeId = await generateEmployeeIdBasedOnJoiningDate(formattedJoiningDate);
        console.log('Generated Employee ID:', employeeId);

        // Calculate initial joining months count (0 for new employees)
        const monthsCompleted = 0;
        const canApplyLeave = false;

        // Start transaction - Supabase doesn't support transactions directly
        // We'll do sequential operations with error handling

        try {
            // Insert employee
            console.log('Inserting employee with data:', {
                employee_id: employeeId,
                first_name,
                middle_name: middle_name || null,
                last_name,
                dob: formattedDob,
                position,
                joining_date: formattedJoiningDate,
                address,
                department,
                reporting_manager: reporting_manager || null,
                employment_type: employment_type || 'Full Time',
                salary: parseFloat(salary),
                emergency_contact: emergency_contact || null,
                shift_timing: shift_timing || '9:00 AM - 6:00 PM',
                contract_policy: contract_policy || null,
                joining_month_count: monthsCompleted,
                can_apply_leave: canApplyLeave
            });

            const { data: employeeData, error: employeeError } = await supabase
                .from('employees')
                .insert([{
                    employee_id: employeeId,
                    first_name,
                    middle_name: middle_name || null,
                    last_name,
                    dob: formattedDob,
                    position,
                    joining_date: formattedJoiningDate,
                    address,
                    department,
                    reporting_manager: reporting_manager || null,
                    employment_type: employment_type || 'Full Time',
                    salary: parseFloat(salary),
                    emergency_contact: emergency_contact || null,
                    shift_timing: shift_timing || '9:00 AM - 6:00 PM',
                    contract_policy: contract_policy || null,
                    joining_month_count: monthsCompleted,
                    can_apply_leave: canApplyLeave
                }])
                .select();

            if (employeeError) throw employeeError;

            console.log('Employee inserted successfully. ID:', employeeData[0].id);

            // Create user account for employee
            const hashedPassword = await bcrypt.hash('Welcome@123', 10);
            const email = `emp_${employeeId.toLowerCase()}@ems.com`;

            console.log('Creating user account with email:', email);

            const { data: userData, error: userError } = await supabase
                .from('users')
                .insert([{
                    employee_id: employeeId,
                    email: email,
                    password: hashedPassword,
                    role: 'employee'
                }])
                .select();

            if (userError) throw userError;

            console.log('User account created successfully. User ID:', userData[0].id);

            // Initialize leave balance for current year (0 leaves initially)
            try {
                const currentYear = new Date().getFullYear();

                // Check if leave_balance table exists by trying to insert
                const { error: balanceError } = await supabase
                    .from('leave_balance')
                    .insert([{
                        employee_id: employeeId,
                        leave_year: currentYear,
                        total_accrued: 0,
                        total_used: 0,
                        total_pending: 0,
                        current_balance: 0
                    }]);

                if (balanceError && balanceError.code === '42P01') { // Table doesn't exist
                    console.log('Leave balance table does not exist, skipping...');
                } else if (balanceError) {
                    console.log('Error inserting leave balance:', balanceError.message);
                } else {
                    console.log('Leave balance initialized for year', currentYear);
                }
            } catch (balanceError) {
                console.log('Leave balance table might not exist, skipping...', balanceError.message);
            }

            console.log('Employee creation completed successfully');
            console.log('Login credentials:');
            console.log('Email:', email);
            console.log('Password: Welcome@123');

            res.status(201).json({
                success: true,
                message: 'Employee created successfully',
                employeeId,
                id: employeeData[0].id,
                email: email,
                loginCredentials: {
                    email: email,
                    password: 'Welcome@123'
                }
            });

        } catch (error) {
            console.error('Transaction failed, rolling back...');

            // Try to clean up if employee was created but user creation failed
            if (error.message.includes('user') && employeeId) {
                try {
                    await supabase.from('employees').delete().eq('employee_id', employeeId);
                    console.log('Cleaned up employee record after user creation failure');
                } catch (cleanupError) {
                    console.error('Failed to clean up employee:', cleanupError);
                }
            }

            throw error;
        }

    } catch (error) {
        console.error('='.repeat(50));
        console.error('ERROR CREATING EMPLOYEE:');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('Error details:', error.details);
        console.error('Error hint:', error.hint);
        console.error('Stack:', error.stack);
        console.error('='.repeat(50));

        let errorMessage = 'Error creating employee';
        let statusCode = 500;

        if (error.code === '23505') { // PostgreSQL duplicate key error
            errorMessage = 'Employee ID or email already exists';
            statusCode = 409;
        } else if (error.code === '23503') { // Foreign key violation
            errorMessage = 'Foreign key constraint failed';
            statusCode = 400;
        } else if (error.code === '23502') { // Not null violation
            errorMessage = 'Required field cannot be null';
            statusCode = 400;
        } else if (error.code === '42703') { // Undefined column
            errorMessage = 'Database column mismatch. Please check if all columns exist.';
            statusCode = 500;
        } else if (error.message) {
            errorMessage = `Database error: ${error.message}`;
        }

        res.status(statusCode).json({
            success: false,
            message: errorMessage,
            error: error.message,
            code: error.code
        });
    }
};

// Get all employees (for admin)
exports.getAllEmployees = async (req, res) => {
    try {
        const { data: employees, error } = await supabase
            .from('employees')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        console.log(`Found ${employees?.length || 0} employees`);
        res.json(employees || []);
    } catch (error) {
        console.error('Error fetching employees:', error);
        res.status(500).json({ message: 'Error fetching employees' });
    }
};

// Get employee by ID
exports.getEmployeeById = async (req, res) => {
    try {
        const { id } = req.params;

        const { data: employees, error } = await supabase
            .from('employees')
            .select('*')
            .eq('id', id);

        if (error) throw error;

        if (!employees || employees.length === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        res.json(employees[0]);
    } catch (error) {
        console.error('Error fetching employee:', error);
        res.status(500).json({ message: 'Error fetching employee', error: error.message });
    }
};

// Get employee profile by employee_id
exports.getEmployeeProfile = async (req, res) => {
    try {
        const { employeeId } = req.params;

        const { data: employees, error } = await supabase
            .from('employees')
            .select('*')
            .eq('employee_id', employeeId);

        if (error) throw error;

        if (!employees || employees.length === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        res.json(employees[0]);
    } catch (error) {
        console.error('Error fetching employee profile:', error);
        res.status(500).json({ message: 'Error fetching employee profile' });
    }
};

// Update employee
exports.updateEmployee = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = { ...req.body };

        console.log('='.repeat(50));
        console.log('📝 UPDATE EMPLOYEE REQUEST');
        console.log('Employee ID:', id);
        console.log('Updates received:', JSON.stringify(updates, null, 2));
        console.log('='.repeat(50));

        // First, check if employee exists
        const { data: existingEmployee, error: fetchError } = await supabase
            .from('employees')
            .select('id, employee_id')
            .eq('id', id);

        if (fetchError) {
            console.error('Error fetching employee:', fetchError);
            throw fetchError;
        }

        if (!existingEmployee || existingEmployee.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Remove fields that shouldn't be updated
        const restrictedFields = [
            'id',
            'employee_id',
            'created_at',
            'updated_at',
            'joining_month_count',
            'can_apply_leave'
        ];

        restrictedFields.forEach(field => {
            delete updates[field];
        });

        // Format dates if present
        if (updates.dob) {
            updates.dob = formatDateForPostgres(updates.dob);
        }
        if (updates.joining_date) {
            updates.joining_date = formatDateForPostgres(updates.joining_date);
        }

        // Convert salary fields to numbers if present
        if (updates.salary) {
            updates.salary = parseFloat(updates.salary);
        }
        if (updates.gross_salary) {
            updates.gross_salary = parseFloat(updates.gross_salary);
        }
        if (updates.in_hand_salary) {
            updates.in_hand_salary = parseFloat(updates.in_hand_salary);
        }

        // Handle empty strings as null for optional fields
        const optionalFields = [
            'middle_name', 'phone', 'city', 'state', 'pincode',
            'blood_group', 'emergency_contact', 'reporting_manager',
            'bank_account_name', 'account_number', 'ifsc_code',
            'branch_name', 'pan_number', 'aadhar_number',
            'contract_policy', 'shift_timing', 'employment_type'
        ];

        optionalFields.forEach(field => {
            if (updates[field] === '') {
                updates[field] = null;
            }
        });

        // Remove any fields that are undefined
        Object.keys(updates).forEach(key => {
            if (updates[key] === undefined) {
                delete updates[key];
            }
        });

        console.log('Processed updates:', JSON.stringify(updates, null, 2));

        // If no fields to update
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid fields to update'
            });
        }

        // Update employee
        const { data: updatedEmployee, error: updateError } = await supabase
            .from('employees')
            .update(updates)
            .eq('id', id)
            .select();

        if (updateError) {
            console.error('Update error:', updateError);
            throw updateError;
        }

        if (!updatedEmployee || updatedEmployee.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found after update'
            });
        }

        console.log('✅ Employee updated successfully:', updatedEmployee[0].employee_id);

        // Also update the email in users table if email was changed
        if (updates.email) {
            const { error: userUpdateError } = await supabase
                .from('users')
                .update({ email: updates.email })
                .eq('employee_id', updatedEmployee[0].employee_id);

            if (userUpdateError) {
                console.warn('⚠️ Could not update user email:', userUpdateError.message);
                // Don't throw error, just log it
            }
        }

        res.json({
            success: true,
            message: 'Employee updated successfully',
            employee: updatedEmployee[0]
        });

    } catch (error) {
        console.error('='.repeat(50));
        console.error('❌ ERROR UPDATING EMPLOYEE:');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('Error details:', error.details);
        console.error('Error hint:', error.hint);
        console.error('Stack:', error.stack);
        console.error('='.repeat(50));

        let errorMessage = 'Error updating employee';
        let statusCode = 500;

        if (error.code === '23505') {
            errorMessage = 'Duplicate entry - email or employee ID already exists';
            statusCode = 409;
        } else if (error.code === '23503') {
            errorMessage = 'Foreign key constraint violation';
            statusCode = 400;
        } else if (error.code === '23502') {
            errorMessage = 'Required field cannot be null';
            statusCode = 400;
        } else if (error.code === '42703') {
            errorMessage = 'Database column does not exist. Please check the field names.';
            statusCode = 500;
        } else if (error.message) {
            errorMessage = error.message;
        }

        res.status(statusCode).json({
            success: false,
            message: errorMessage,
            error: error.message,
            code: error.code,
            details: error.details
        });
    }
};

// Helper function to format dates
const formatDateForPostgres = (dateStr) => {
    if (!dateStr) return null;

    // If already in YYYY-MM-DD format
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return dateStr;
    }

    // If date is in MM/DD/YYYY format
    if (dateStr.includes('/')) {
        const [month, day, year] = dateStr.split('/');
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    // If date is in DD/MM/YYYY format
    if (dateStr.includes('-')) {
        const parts = dateStr.split('-');
        if (parts[0].length === 4) {
            return dateStr; // Already YYYY-MM-DD
        }
        // Assume DD-MM-YYYY
        const [day, month, year] = parts;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    return dateStr;
};

// Delete employee
exports.deleteEmployee = async (req, res) => {
    try {
        const { id } = req.params;

        // First get the employee to know their employee_id
        const { data: employee, error: fetchError } = await supabase
            .from('employees')
            .select('employee_id')
            .eq('id', id);

        if (fetchError) throw fetchError;

        if (!employee || employee.length === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        const employeeId = employee[0].employee_id;

        // Delete from users table first (due to foreign key)
        const { error: userError } = await supabase
            .from('users')
            .delete()
            .eq('employee_id', employeeId);

        if (userError) throw userError;

        // Then delete from employees table
        const { error: empError } = await supabase
            .from('employees')
            .delete()
            .eq('id', id);

        if (empError) throw empError;

        res.json({
            message: 'Employee deleted successfully',
            employeeId: employeeId
        });
    } catch (error) {
        console.error('Error deleting employee:', error);
        res.status(500).json({ message: 'Error deleting employee' });
    }
};

// Upload employee documents
exports.uploadDocuments = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const files = req.files;

        console.log('='.repeat(50));
        console.log('UPLOAD DOCUMENTS REQUEST');
        console.log('Employee ID:', employeeId);
        console.log('Files received:', Object.keys(files || {}));
        console.log('='.repeat(50));

        if (!files || Object.keys(files).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No files uploaded'
            });
        }

        const uploadedFiles = {};

        // Process each uploaded file
        Object.keys(files).forEach(fieldname => {
            if (files[fieldname] && files[fieldname][0]) {
                const file = files[fieldname][0];
                uploadedFiles[fieldname] = file.filename;
                console.log(`File uploaded for ${fieldname}:`, {
                    filename: file.filename,
                    originalName: file.originalname,
                    size: file.size,
                    mimetype: file.mimetype,
                    path: file.path
                });
            }
        });

        console.log('Files to update in database:', uploadedFiles);

        // Update employee record with file paths
        if (Object.keys(uploadedFiles).length > 0) {
            const { data, error } = await supabase
                .from('employees')
                .update(uploadedFiles)
                .eq('employee_id', employeeId)
                .select();

            if (error) throw error;

            console.log('Database update result:', {
                updated: data?.length || 0
            });
        }

        // Fetch the updated employee to verify
        const { data: updatedEmployee, error: fetchError } = await supabase
            .from('employees')
            .select('*')
            .eq('employee_id', employeeId);

        if (fetchError) throw fetchError;

        console.log('Updated employee records:', updatedEmployee[0]);

        res.json({
            success: true,
            message: 'Documents uploaded successfully',
            files: uploadedFiles,
            employee: updatedEmployee[0]
        });

    } catch (error) {
        console.error('='.repeat(50));
        console.error('ERROR UPLOADING DOCUMENTS:');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        console.error('='.repeat(50));

        res.status(500).json({
            success: false,
            message: 'Error uploading documents',
            error: error.message
        });
    }
};

// Get employee documents
exports.getEmployeeDocuments = async (req, res) => {
    try {
        const { employeeId } = req.params;

        console.log('Fetching documents for employee:', employeeId);

        const { data: employees, error } = await supabase
            .from('employees')
            .select(`
                profile_image, 
                appointment_letter, 
                offer_letter, 
                contract_document, 
                aadhar_card, 
                pan_card,
                relieving_letter,
                salary_slip,
                bank_proof,
                education_certificates,
                experience_certificates
            `)
            .eq('employee_id', employeeId);

        if (error) throw error;

        if (!employees || employees.length === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        // Filter out null/undefined/empty values
        const documents = {};
        Object.keys(employees[0]).forEach(key => {
            const value = employees[0][key];
            if (value && value !== 'null' && value !== '') {
                documents[key] = value;
            }
        });

        console.log('Documents found:', documents);

        res.json(documents);

    } catch (error) {
        console.error('Error fetching documents:', error);
        res.status(500).json({ message: 'Error fetching documents', error: error.message });
    }
};

// Download document
exports.downloadDocument = async (req, res) => {
    try {
        const { employeeId, documentType } = req.params;

        console.log('='.repeat(50));
        console.log('DOWNLOAD DOCUMENT REQUEST');
        console.log('Employee ID/Param:', employeeId);
        console.log('Document Type:', documentType);
        console.log('='.repeat(50));

        // First, try to find the employee by id or employee_id
        const { data: employees, error } = await supabase
            .from('employees')
            .select('*')
            .or(`id.eq.${employeeId},employee_id.eq.${employeeId}`);

        if (error) throw error;

        if (!employees || employees.length === 0) {
            console.log('Employee not found for ID:', employeeId);
            return res.status(404).json({ message: 'Employee not found' });
        }

        const employee = employees[0];
        console.log('Found employee:', employee.employee_id, employee.first_name);

        // Get the filename from the database
        const filename = employee[documentType];

        if (!filename) {
            console.log('Document not found for type:', documentType);
            return res.status(404).json({ message: 'Document not found in database' });
        }

        console.log('Document filename:', filename);

        // Determine the correct file path
        const baseDir = path.join(__dirname, '..');
        let filePath;

        if (documentType === 'profile_image') {
            filePath = path.join(baseDir, 'uploads/profiles/', filename);
        } else {
            filePath = path.join(baseDir, 'uploads/documents/', filename);
        }

        console.log('Looking for file at:', filePath);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            console.log('File not found on disk at:', filePath);

            // Try alternative paths
            const altPath = path.join(baseDir, 'uploads/documents/', filename);
            console.log('Trying alternative path:', altPath);

            if (fs.existsSync(altPath)) {
                console.log('File found at alternative path');
                filePath = altPath;
            } else {
                return res.status(404).json({ message: 'File not found on server' });
            }
        }

        // Get file stats
        const stats = fs.statSync(filePath);
        const ext = path.extname(filename).toLowerCase();

        console.log('File extension:', ext);
        console.log('File size:', stats.size);

        // Set appropriate headers based on file type
        let contentType = 'application/octet-stream';
        let contentDisposition = `inline; filename="${filename}"`;

        // Handle different file types
        const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
        const pdfExts = ['.pdf'];
        const wordExts = ['.doc', '.docx'];
        const textExts = ['.txt', '.csv', '.json'];

        if (pdfExts.includes(ext)) {
            contentType = 'application/pdf';
            contentDisposition = `inline; filename="${filename}"`; // Show in browser
        }
        else if (imageExts.includes(ext)) {
            contentType = `image/${ext.replace('.', '')}`;
            contentDisposition = `inline; filename="${filename}"`; // Show in browser
        }
        else if (wordExts.includes(ext)) {
            contentType = ext === '.doc' ? 'application/msword' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            contentDisposition = `attachment; filename="${filename}"`; // Force download
        }
        else if (textExts.includes(ext)) {
            contentType = 'text/plain';
            contentDisposition = `inline; filename="${filename}"`; // Show in browser
        }
        else {
            // For other file types, force download
            contentDisposition = `attachment; filename="${filename}"`;
        }

        // Set headers
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', contentDisposition);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Access-Control-Allow-Origin', '*');

        console.log('Sending file with headers:', {
            contentType,
            contentDisposition,
            contentLength: stats.size
        });

        // Send the file
        res.sendFile(filePath);

    } catch (error) {
        console.error('='.repeat(50));
        console.error('ERROR DOWNLOADING DOCUMENT:');
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        console.error('='.repeat(50));

        res.status(500).json({
            success: false,
            message: 'Error downloading document',
            error: error.message
        });
    }
};

// Add endpoint to manually update all employees' months
exports.updateAllEmployeesMonths = async (req, res) => {
    try {
        const results = await EmployeeService.updateAllEmployeesMonths();
        res.json({
            success: true,
            message: 'All employees updated successfully',
            results
        });
    } catch (error) {
        console.error('Error updating employees:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating employees',
            error: error.message
        });
    }
};

exports.updateEmployeeMonths = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const result = await EmployeeService.updateEmployeeMonths(employeeId);
        res.json({
            success: true,
            message: 'Employee updated successfully',
            ...result
        });
    } catch (error) {
        console.error('Error updating employee:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating employee',
            error: error.message
        });
    }
};