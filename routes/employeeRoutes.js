const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { verifyToken, isAdmin } = require('../middleware/auth');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, '../uploads/documents');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only images and documents are allowed'));
        }
    }
});

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

// ============== REPORTING MANAGER: GET TEAM MEMBERS ==============
router.get('/manager/team', verifyToken, async (req, res) => {
    try {
        const managerEmployeeId = req.user?.employeeId;
        const { data: manager, error: mErr } = await supabase
            .from('employees').select('first_name, last_name')
            .eq('employee_id', managerEmployeeId).single();
        if (mErr || !manager) return res.status(404).json({ success: false, message: 'Manager not found' });

        const managerName = `${manager.first_name} ${manager.last_name}`.trim();

        // Fetch team members - trim stored values to handle any whitespace issues
        const { data: allEmps, error } = await supabase
            .from('employees')
            .select('id, employee_id, first_name, last_name, department, designation, shift_timing, reporting_manager')
            .order('first_name', { ascending: true });

        if (error) throw error;

        // Filter in JS: trim + lowercase compare to handle any DB whitespace/case issues
        const team = (allEmps || []).filter(e =>
            e.reporting_manager?.trim().toLowerCase() === managerName.toLowerCase()
        );

        res.json({ success: true, team, manager_name: managerName });
    } catch (error) {
        console.error('Error fetching team:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch team', error: error.message });
    }
});

// ============== REPORTING MANAGER: UPDATE TEAM MEMBER SHIFT ==============
router.put('/manager/shift/:employee_id', verifyToken, async (req, res) => {
    try {
        const { employee_id } = req.params;
        const { shift_timing } = req.body;
        const managerEmployeeId = req.user?.employeeId;

        if (!shift_timing || !shift_timing.trim()) {
            return res.status(400).json({ success: false, message: 'Shift timing is required' });
        }

        const { data: manager, error: mErr } = await supabase
            .from('employees').select('first_name, last_name')
            .eq('employee_id', managerEmployeeId).single();
        if (mErr || !manager) return res.status(403).json({ success: false, message: 'Manager not found' });

        const managerName = `${manager.first_name} ${manager.last_name}`.trim();

        const { data: emp, error: empErr } = await supabase
            .from('employees').select('employee_id, first_name, last_name, reporting_manager')
            .eq('employee_id', employee_id).single();
        if (empErr || !emp) return res.status(404).json({ success: false, message: 'Employee not found' });

        if (emp.reporting_manager?.trim().toLowerCase() !== managerName.toLowerCase()) {
            return res.status(403).json({ success: false, message: 'You can only update shift for employees who report to you' });
        }

        const { data, error } = await supabase
            .from('employees')
            .update({ shift_timing: shift_timing.trim(), updated_at: new Date().toISOString() })
            .eq('employee_id', employee_id)
            .select('employee_id, first_name, last_name, shift_timing');

        if (error) throw error;
        res.json({ success: true, message: `Shift updated for ${emp.first_name} ${emp.last_name}`, employee: data[0] });
    } catch (error) {
        console.error('Error updating shift:', error);
        res.status(500).json({ success: false, message: 'Failed to update shift', error: error.message });
    }
});

// ============== TODAY'S EVENTS ROUTE (BIRTHDAYS & ANNIVERSARIES) ==============
router.get('/today-events', async (req, res) => {
    try {
        const today = new Date();
        const todayMonth = today.getMonth() + 1;
        const todayDay = today.getDate();

        console.log('📅 Fetching events for date:', `${todayMonth}-${todayDay}`);

        // Get all employees
        const { data: employees, error } = await supabase
            .from('employees')
            .select('*');

        if (error) throw error;

        const birthdays = [];
        const anniversaries = [];

        (employees || []).forEach(emp => {
            // Check birthday
            if (emp.dob) {
                const dob = new Date(emp.dob);
                const dobMonth = dob.getMonth() + 1;
                const dobDay = dob.getDate();

                if (dobMonth === todayMonth && dobDay === todayDay) {
                    birthdays.push({
                        id: emp.id,
                        employee_id: emp.employee_id,
                        first_name: emp.first_name,
                        last_name: emp.last_name,
                        department: emp.department,
                        position: emp.designation || emp.position,
                        profile_image: emp.profile_image
                    });
                }
            }

            // Check work anniversary
            if (emp.joining_date) {
                const joiningDate = new Date(emp.joining_date);
                const joiningMonth = joiningDate.getMonth() + 1;
                const joiningDay = joiningDate.getDate();

                if (joiningMonth === todayMonth && joiningDay === todayDay) {
                    const years = today.getFullYear() - joiningDate.getFullYear();
                    if (years > 0) { // Only count if at least 1 year completed
                        anniversaries.push({
                            id: emp.id,
                            employee_id: emp.employee_id,
                            first_name: emp.first_name,
                            last_name: emp.last_name,
                            department: emp.department,
                            position: emp.designation || emp.position,
                            profile_image: emp.profile_image,
                            joining_date: emp.joining_date,
                            years: years
                        });
                    }
                }
            }
        });

        console.log(`✅ Found ${birthdays.length} birthdays and ${anniversaries.length} anniversaries today`);

        res.json({
            success: true,
            date: today.toISOString().split('T')[0],
            birthdays,
            anniversaries,
            total: birthdays.length + anniversaries.length
        });

    } catch (error) {
        console.error('❌ Error fetching today events:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch events',
            error: error.message
        });
    }
});

// ============== EMPLOYEE CRUD OPERATIONS ==============

router.post('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const employeeData = req.body;
        let retryCount = 0;
        const maxRetries = 5;

        while (retryCount < maxRetries) {
            try {
                console.log('='.repeat(50));
                console.log('📝 CREATE EMPLOYEE REQUEST (Attempt', retryCount + 1, ')');
                console.log('Request body:', JSON.stringify(employeeData, null, 2));
                console.log('='.repeat(50));

                // Check if employee_id already exists
                const { data: existingId, error: idCheckError } = await supabase
                    .from('employees')
                    .select('employee_id')
                    .eq('employee_id', employeeData.employee_id);

                if (idCheckError) throw idCheckError;

                if (existingId && existingId.length > 0) {
                    console.log('⚠️ Employee ID already exists:', employeeData.employee_id);
                    console.log('Retrying with new ID...');

                    // Generate new ID
                    employeeData.employee_id = await generateEmployeeIdBasedOnJoiningDate(employeeData.joining_date);
                    retryCount++;
                    continue;
                }

                // Check if email already exists
                const { data: existingEmail, error: emailCheckError } = await supabase
                    .from('employees')
                    .select('email')
                    .eq('email', employeeData.email);

                if (emailCheckError) throw emailCheckError;

                if (existingEmail && existingEmail.length > 0) {
                    console.log('❌ Email already exists:', employeeData.email);
                    return res.status(400).json({
                        success: false,
                        message: 'Email already exists',
                        field: 'email',
                        value: employeeData.email
                    });
                }

                // ... rest of your validation code ...

                const newEmployee = {
                    first_name: employeeData.first_name,
                    middle_name: employeeData.middle_name || null,
                    last_name: employeeData.last_name,
                    employee_id: employeeData.employee_id,
                    email: employeeData.email,
                    joining_date: employeeData.joining_date,
                    designation: employeeData.designation,
                    department: employeeData.department,
                    reporting_manager: employeeData.reporting_manager || null,
                    employment_type: employeeData.employment_type || 'Full Time',
                    shift_timing: employeeData.shift_timing || '9:00 AM - 6:00 PM',
                    in_hand_salary: employeeData.in_hand_salary || 0,
                    gross_salary: employeeData.gross_salary || 0,
                    bank_account_name: employeeData.bank_account_name || null,
                    account_number: employeeData.account_number || null,
                    ifsc_code: employeeData.ifsc_code || null,
                    branch_name: employeeData.branch_name || null,
                    pan_number: employeeData.pan_number || null,
                    aadhar_number: employeeData.aadhar_number || null,
                    dob: employeeData.dob || null,
                    address: employeeData.address || null,
                    blood_group: employeeData.blood_group || null,
                    emergency_contact: employeeData.emergency_contact || null,
                    contract_policy: employeeData.contract_policy || null,
                    is_active: true,
                    role: 'employee',
                    joining_month_count: 0,
                    can_apply_leave: false,
                    created_at: new Date().toISOString()
                };

                console.log('📦 Inserting employee with data:', newEmployee);

                const { data, error } = await supabase
                    .from('employees')
                    .insert([newEmployee])
                    .select();

                if (error) {
                    if (error.code === '23505') { // Duplicate key error
                        console.log('⚠️ Duplicate key error, retrying with new ID...');
                        employeeData.employee_id = await generateEmployeeIdBasedOnJoiningDate(employeeData.joining_date);
                        retryCount++;
                        continue;
                    }
                    throw error;
                }

                console.log('✅ Employee created successfully:', data[0]);

                return res.status(201).json({
                    success: true,
                    message: 'Employee created successfully',
                    employee: {
                        id: data[0].id,
                        employee_id: data[0].employee_id
                    }
                });

            } catch (error) {
                if (retryCount >= maxRetries - 1) throw error;
                retryCount++;
            }
        }

        throw new Error('Failed to create employee after multiple retries');

    } catch (error) {
        console.error('❌ Error creating employee:', error);

        res.status(500).json({
            success: false,
            message: 'Failed to create employee',
            error: error.message,
            details: error.details || error.hint
        });
    }
});

// Update employee (Admin only)
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Remove fields that shouldn't be updated
        delete updates.id;
        delete updates.employee_id;
        delete updates.created_at;

        // Add updated timestamp
        updates.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from('employees')
            .update(updates)
            .eq('id', id)
            .select();

        if (error) throw error;

        if (!data || data.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        res.json({
            success: true,
            message: 'Employee updated successfully',
            employee: data[0]
        });

    } catch (error) {
        console.error('Error updating employee:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update employee',
            error: error.message
        });
    }
});

// Get employee by ID (with all fields)
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        console.log(`📤 Fetching employee with ID: ${id}`);

        let query = supabase
            .from('employees')
            .select('*');

        // Check if id is number or string
        if (!isNaN(id)) {
            query = query.eq('id', parseInt(id));
        } else {
            query = query.eq('employee_id', id);
        }

        const { data, error } = await query.single();

        if (error) {
            if (error.code === 'PGRST116') { // No rows returned
                return res.status(404).json({
                    success: false,
                    message: 'Employee not found'
                });
            }
            throw error;
        }

        console.log('📤 Sending employee data:', Object.keys(data));
        res.json(data);

    } catch (error) {
        console.error('❌ Error fetching employee:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get employee by employee_id (for profile)
router.get('/profile/:employeeId', async (req, res) => {
    try {
        const { employeeId } = req.params;

        const { data, error } = await supabase
            .from('employees')
            .select('*')
            .eq('employee_id', employeeId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    message: 'Employee not found'
                });
            }
            throw error;
        }

        res.json(data);

    } catch (error) {
        console.error('Error fetching employee profile:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch employee profile',
            error: error.message
        });
    }
});


// Get all employees (returns array directly)
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 50, department, search, active } = req.query;
        const offset = (page - 1) * limit;

        let query = supabase
            .from('employees')
            .select('*', { count: 'exact' });

        // Apply filters
        if (department) {
            query = query.eq('department', department);
        }

        if (search) {
            query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,employee_id.ilike.%${search}%,email.ilike.%${search}%`);
        }

        // Filter active employees if requested
        if (active === 'true') {
            query = query.eq('is_active', true);
        }

        // Apply pagination
        query = query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        const { data, error, count } = await query;

        if (error) throw error;

        console.log(`📊 Found ${data?.length || 0} employees`);

        // Return array directly
        res.json(data || []);

    } catch (error) {
        console.error('Error fetching employees:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch employees',
            error: error.message
        });
    }
});

// Delete employee (Admin only - HARD DELETE)
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // First get the employee to know their employee_id
        const { data: employee, error: fetchError } = await supabase
            .from('employees')
            .select('employee_id')
            .eq('id', id);

        if (fetchError) throw fetchError;

        if (!employee || employee.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        const employeeId = employee[0].employee_id;

        // Delete from users table first (due to foreign key)
        const { error: userError } = await supabase
            .from('users')
            .delete()
            .eq('employee_id', employeeId);

        if (userError) {
            console.error('Error deleting from users:', userError);
            // Continue even if user delete fails
        }

        // Delete from leave_balance
        const { error: leaveError } = await supabase
            .from('leave_balance')
            .delete()
            .eq('employee_id', employeeId);

        if (leaveError) {
            console.error('Error deleting leave balance:', leaveError);
        }

        // Delete from leaves
        const { error: leavesError } = await supabase
            .from('leaves')
            .delete()
            .eq('employee_id', employeeId);

        if (leavesError) {
            console.error('Error deleting leaves:', leavesError);
        }

        // Delete from attendance
        const { error: attendanceError } = await supabase
            .from('attendance')
            .delete()
            .eq('employee_id', employeeId);

        if (attendanceError) {
            console.error('Error deleting attendance:', attendanceError);
        }

        // Finally delete from employees table
        const { error: empError } = await supabase
            .from('employees')
            .delete()
            .eq('id', id);

        if (empError) throw empError;

        res.json({
            success: true,
            message: 'Employee permanently deleted successfully',
            employeeId: employeeId
        });

    } catch (error) {
        console.error('Error deleting employee:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete employee',
            error: error.message
        });
    }
});

// Hard delete (Admin only - use with caution)
router.delete('/:id/hard', verifyToken, isAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const { error } = await supabase
            .from('employees')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({
            success: true,
            message: 'Employee permanently deleted'
        });
    } catch (error) {
        console.error('Error hard deleting employee:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete employee',
            error: error.message
        });
    }
});

// ============== DOCUMENT MANAGEMENT ==============

// Upload documents
router.post('/:employeeId/documents', verifyToken, upload.any(), async (req, res) => {
    try {
        const { employeeId } = req.params;
        const files = req.files;

        console.log('📥 Document upload request received for employee:', employeeId);
        console.log('📦 Files received:', files?.length || 0);

        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No files uploaded'
            });
        }

        const documentUpdates = {};

        files.forEach(file => {
            const fieldName = file.fieldname;
            documentUpdates[fieldName] = file.filename;
            console.log(`📄 File mapping: ${fieldName} -> ${file.filename}`);
        });

        console.log('📝 Updating employee with documents:', documentUpdates);

        // Update employee record with document names
        if (Object.keys(documentUpdates).length > 0) {
            const { data, error } = await supabase
                .from('employees')
                .update(documentUpdates)
                .eq('employee_id', employeeId)
                .select();

            if (error) {
                console.error('❌ Database update error:', error);
                throw error;
            }

            console.log('✅ Database updated successfully. Updated fields:', data);
        }

        // Fetch the updated employee to verify
        const { data: updatedEmployee, error: fetchError } = await supabase
            .from('employees')
            .select('*')
            .eq('employee_id', employeeId);

        if (fetchError) {
            console.error('❌ Error fetching updated employee:', fetchError);
        } else {
            console.log('📊 Updated employee documents:', {
                profile_image: updatedEmployee[0]?.profile_image,
                appointment_letter: updatedEmployee[0]?.appointment_letter,
            });
        }

        res.json({
            success: true,
            message: 'Documents uploaded successfully',
            documents: documentUpdates,
            updated_employee: updatedEmployee[0]
        });

    } catch (error) {
        console.error('❌ Error uploading documents:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload documents',
            error: error.message
        });
    }
});

// Get employee documents
router.get('/:employeeId/documents', async (req, res) => {
    try {
        const { employeeId } = req.params;

        console.log('📄 Fetching documents for employee:', employeeId);

        // First verify employee exists
        const { data: employee, error: empError } = await supabase
            .from('employees')
            .select('id')
            .eq('employee_id', employeeId)
            .maybeSingle();

        if (empError) {
            console.error('❌ Error checking employee:', empError);
            throw empError;
        }

        if (!employee) {
            console.log('⚠️ Employee not found:', employeeId);
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Now fetch documents
        const { data, error } = await supabase
            .from('employees')
            .select(`
                profile_image, appointment_letter, offer_letter, 
                contract_document, aadhar_card, pan_card, 
                bank_proof, education_certificates, experience_certificates,
                relieving_letter, salary_slip
            `)
            .eq('employee_id', employeeId)
            .maybeSingle();

        if (error) {
            console.error('❌ Error fetching documents:', error);
            throw error;
        }

        if (!data) {
            console.log('⚠️ No document record found for employee:', employeeId);
            return res.json({});
        }

        // Filter out null values
        const documents = {};
        Object.keys(data).forEach(key => {
            if (data[key]) {
                documents[key] = data[key];
            }
        });

        console.log('✅ Documents fetched successfully:', Object.keys(documents));
        res.json(documents);

    } catch (error) {
        console.error('❌ Error in documents endpoint:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch documents',
            error: error.message,
            details: error.details || error.hint
        });
    }
});


// Download specific document - WITHOUT requiring token (since it's accessed via blob URL)
router.get('/:employeeId/documents/:documentType', async (req, res) => {
    try {
        const { employeeId, documentType } = req.params;
        const { inline } = req.query;

        console.log('📥 Document download request:', { employeeId, documentType });

        // Note: We're NOT checking for token here because this endpoint is accessed
        // via blob URLs. The token check happens in the initial API call that fetches the blob.
        // If you want to keep it secure, you can check referrer or implement a temporary token system.

        const { data, error } = await supabase
            .from('employees')
            .select(documentType)
            .eq('employee_id', employeeId)
            .single();

        if (error || !data || !data[documentType]) {
            return res.status(404).json({
                success: false,
                message: 'Document not found'
            });
        }

        const filename = data[documentType];
        const filePath = path.join(__dirname, '../uploads/documents', filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                message: 'File not found on server'
            });
        }

        // Set appropriate headers for viewing/downloading
        if (inline === 'true') {
            res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        } else {
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        }

        // Set content type based on file extension
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes = {
            '.pdf': 'application/pdf',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.txt': 'text/plain'
        };

        if (mimeTypes[ext]) {
            res.setHeader('Content-Type', mimeTypes[ext]);
        }

        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Access-Control-Allow-Origin', '*');

        console.log('📤 Sending file:', filename);
        res.sendFile(filePath);

    } catch (error) {
        console.error('❌ Error downloading document:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to download document',
            error: error.message
        });
    }
});

// Delete specific document
router.delete('/:employeeId/documents/:documentType', verifyToken, async (req, res) => {
    try {
        const { employeeId, documentType } = req.params;

        // Get filename first
        const { data, error: fetchError } = await supabase
            .from('employees')
            .select(documentType)
            .eq('employee_id', employeeId)
            .single();

        if (fetchError) throw fetchError;

        if (data && data[documentType]) {
            const filename = data[documentType];
            const filePath = path.join(__dirname, '../uploads/documents', filename);

            // Delete file from filesystem
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        // Update database
        const { error: updateError } = await supabase
            .from('employees')
            .update({ [documentType]: null })
            .eq('employee_id', employeeId);

        if (updateError) throw updateError;

        res.json({
            success: true,
            message: 'Document deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting document:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete document',
            error: error.message
        });
    }
});

// Get employee statistics (Admin only)
router.get('/stats/summary', verifyToken, isAdmin, async (req, res) => {
    try {
        // Total employees
        const { count: total, error: totalError } = await supabase
            .from('employees')
            .select('*', { count: 'exact', head: true });

        if (totalError) throw totalError;

        // Active employees
        const { count: active, error: activeError } = await supabase
            .from('employees')
            .select('*', { count: 'exact', head: true })
            .eq('is_active', true);

        if (activeError) throw activeError;

        // Department wise count
        const { data: deptStats, error: deptError } = await supabase
            .from('employees')
            .select('department, count')
            .eq('is_active', true);

        if (deptError) throw deptError;

        // Process department stats
        const deptMap = {};
        deptStats?.forEach(item => {
            deptMap[item.department] = (deptMap[item.department] || 0) + 1;
        });

        const deptArray = Object.entries(deptMap).map(([department, count]) => ({
            department,
            count
        }));

        // Recent joinings (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { count: recent, error: recentError } = await supabase
            .from('employees')
            .select('*', { count: 'exact', head: true })
            .gte('joining_date', thirtyDaysAgo.toISOString().split('T')[0]);

        if (recentError) throw recentError;

        res.json({
            success: true,
            stats: {
                total: total || 0,
                active: active || 0,
                inactive: (total || 0) - (active || 0),
                recent_joinings: recent || 0,
                department_breakdown: deptArray || []
            }
        });

    } catch (error) {
        console.error('Error fetching employee stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch statistics',
            error: error.message
        });
    }
});

module.exports = router;