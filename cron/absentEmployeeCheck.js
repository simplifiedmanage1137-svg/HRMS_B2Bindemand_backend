const cron = require('node-cron');
const supabase = require('../config/supabase');

// Helper function to get IST date string
const getISTDateString = () => {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    const istTime = new Date(now.getTime() + istOffset);
    return istTime.toISOString().split('T')[0]; // YYYY-MM-DD format
};

// Helper function to check if date is weekend or holiday
const isWeekendOrHoliday = (date) => {
    const dayOfWeek = new Date(date).getDay();
    // 0 = Sunday, 6 = Saturday
    return dayOfWeek === 0 || dayOfWeek === 6;
};

// Function to mark absent employees and create leave records
const markAbsentEmployeesAsLeave = async () => {
    try {
        console.log('🔄 Starting daily absent employee check...');
        
        const today = getISTDateString();
        console.log(`📅 Processing date: ${today}`);
        
        // Skip weekends
        if (isWeekendOrHoliday(today)) {
            console.log('📅 Skipping weekend/holiday');
            return { success: true, message: 'Skipped weekend/holiday' };
        }
        
        // Get all active employees
        const { data: employees, error: empError } = await supabase
            .from('employees')
            .select('employee_id, first_name, last_name, joining_date')
            .eq('is_active', true);
            
        if (empError) {
            console.error('❌ Error fetching employees:', empError);
            return { success: false, error: empError.message };
        }
        
        console.log(`👥 Found ${employees.length} active employees`);
        
        let absentCount = 0;
        let leaveCreatedCount = 0;
        let skippedCount = 0;
        
        for (const employee of employees) {
            try {
                // Check if employee has attendance record for today
                const { data: attendance, error: attError } = await supabase
                    .from('attendance')
                    .select('id, status, clock_in')
                    .eq('employee_id', employee.employee_id)
                    .eq('attendance_date', today)
                    .maybeSingle();
                    
                if (attError) {
                    console.error(`❌ Error checking attendance for ${employee.employee_id}:`, attError);
                    continue;
                }
                
                // If no attendance record exists, employee is absent
                if (!attendance) {
                    console.log(`❌ ${employee.employee_id} (${employee.first_name} ${employee.last_name}) - No attendance record`);
                    
                    // Create attendance record with absent status
                    const { error: insertAttError } = await supabase
                        .from('attendance')
                        .insert([{
                            employee_id: employee.employee_id,
                            attendance_date: today,
                            status: 'absent',
                            total_hours: 0,
                            total_minutes: 0,
                            late_minutes: 0,
                            created_at: new Date().toISOString()
                        }]);
                        
                    if (insertAttError) {
                        console.error(`❌ Error creating attendance record for ${employee.employee_id}:`, insertAttError);
                        continue;
                    }
                    
                    absentCount++;
                    
                    // Check if employee already has a leave record for today
                    const { data: existingLeave, error: leaveCheckError } = await supabase
                        .from('leaves')
                        .select('id')
                        .eq('employee_id', employee.employee_id)
                        .eq('start_date', today)
                        .eq('end_date', today)
                        .maybeSingle();
                        
                    if (leaveCheckError) {
                        console.error(`❌ Error checking existing leave for ${employee.employee_id}:`, leaveCheckError);
                        continue;
                    }
                    
                    // If no leave record exists, create one
                    if (!existingLeave) {
                        // IST timestamp for created_at
                        const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
                        const nowUTC = new Date();
                        const istMs = nowUTC.getTime() + IST_OFFSET_MS;
                        const istDate = new Date(istMs);
                        const createdAtIST = `${istDate.getUTCFullYear()}-${String(istDate.getUTCMonth()+1).padStart(2,'0')}-${String(istDate.getUTCDate()).padStart(2,'0')} ${String(istDate.getUTCHours()).padStart(2,'0')}:${String(istDate.getUTCMinutes()).padStart(2,'0')}:${String(istDate.getUTCSeconds()).padStart(2,'0')}`;
                        
                        const { error: leaveInsertError } = await supabase
                            .from('leaves')
                            .insert([{
                                employee_id: employee.employee_id,
                                employee_name: `${employee.first_name} ${employee.last_name}`,
                                leave_type: 'Unpaid',
                                leave_duration: 'Full Day',
                                start_date: today,
                                end_date: today,
                                reason: 'Auto-generated: No attendance recorded',
                                days_count: 1,
                                status: 'approved', // Auto-approve system generated leaves
                                applied_date: today,
                                approved_date: today,
                                approved_by: 'SYSTEM',
                                remarks: 'System generated leave for absent employee',
                                created_at: createdAtIST,
                                updated_at: createdAtIST
                            }]);
                            
                        if (leaveInsertError) {
                            console.error(`❌ Error creating leave record for ${employee.employee_id}:`, leaveInsertError);
                        } else {
                            console.log(`✅ Created leave record for ${employee.employee_id}`);
                            leaveCreatedCount++;
                        }
                    } else {
                        console.log(`ℹ️ Leave record already exists for ${employee.employee_id}`);
                        skippedCount++;
                    }
                    
                } else if (attendance && !attendance.clock_in) {
                    // Attendance record exists but no clock_in (should not happen, but handle it)
                    console.log(`⚠️ ${employee.employee_id} - Attendance record exists but no clock_in`);
                    
                    // Update status to absent
                    const { error: updateError } = await supabase
                        .from('attendance')
                        .update({ status: 'absent' })
                        .eq('id', attendance.id);
                        
                    if (updateError) {
                        console.error(`❌ Error updating attendance status for ${employee.employee_id}:`, updateError);
                    } else {
                        absentCount++;
                    }
                }
                
            } catch (employeeError) {
                console.error(`❌ Error processing employee ${employee.employee_id}:`, employeeError);
            }
        }
        
        const result = {
            success: true,
            date: today,
            totalEmployees: employees.length,
            absentCount,
            leaveCreatedCount,
            skippedCount,
            message: `Processed ${employees.length} employees. ${absentCount} marked absent, ${leaveCreatedCount} leave records created, ${skippedCount} skipped.`
        };
        
        console.log('✅ Daily absent check completed:', result);
        return result;
        
    } catch (error) {
        console.error('❌ Error in markAbsentEmployeesAsLeave:', error);
        return { success: false, error: error.message };
    }
};

// Schedule the job to run every day at 11:59 PM IST
const scheduleAbsentCheck = () => {
    // Run at 23:59 IST every day (18:29 UTC)
    cron.schedule('59 23 * * *', async () => {
        console.log('🕐 Running scheduled absent employee check...');
        await markAbsentEmployeesAsLeave();
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata"
    });
    
    console.log('📅 Absent employee check scheduled for 11:59 PM IST daily');
};

// Manual trigger function (for testing or admin use)
const triggerAbsentCheck = async () => {
    console.log('🔄 Manual trigger: Running absent employee check...');
    return await markAbsentEmployeesAsLeave();
};

module.exports = {
    scheduleAbsentCheck,
    triggerAbsentCheck,
    markAbsentEmployeesAsLeave
};