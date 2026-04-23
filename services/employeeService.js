const supabase = require('../config/supabase');

class EmployeeService {
    
    /**
     * Calculate months between two dates
     * @param {string|Date} joiningDate - Employee joining date
     * @param {Date} currentDate - Current date (defaults to now)
     * @returns {number} Number of completed months
     */

    static calculateMonthsBetween(joiningDate, currentDate = new Date()) {
        const join = new Date(joiningDate);
        const current = new Date(currentDate);
        
        let months = (current.getFullYear() - join.getFullYear()) * 12;
        months -= join.getMonth();
        months += current.getMonth();
        
        // Adjust for day of month
        if (current.getDate() < join.getDate()) {
            months--;
        }
        
        return Math.max(0, months);
    }

    /**
     * Calculate years between two dates (for anniversary)
     * @param {string|Date} joiningDate - Employee joining date
     * @param {Date} currentDate - Current date
     * @returns {number} Number of completed years
     */

    static calculateYearsBetween(joiningDate, currentDate = new Date()) {
        const join = new Date(joiningDate);
        const current = new Date(currentDate);
        
        let years = current.getFullYear() - join.getFullYear();
        
        // Adjust if anniversary hasn't occurred this year
        if (current.getMonth() < join.getMonth() || 
            (current.getMonth() === join.getMonth() && current.getDate() < join.getDate())) {
            years--;
        }
        
        return Math.max(0, years);
    }

    /**
     * Update joining_month_count for a single employee
     * @param {string} employeeId - Employee ID
     * @returns {Promise<Object>} Update result
     */

    static async updateEmployeeMonths(employeeId) {
        try {
            // Get employee joining date
            const { data: employees, error } = await supabase
                .from('employees')
                .select('joining_date, first_name, last_name')
                .eq('employee_id', employeeId);

            if (error) throw error;

            if (!employees || employees.length === 0) {
                console.log(`❌ Employee ${employeeId} not found`);
                return { success: false, message: 'Employee not found' };
            }

            const employee = employees[0];
            const joiningDate = employee.joining_date;
            const monthsCompleted = this.calculateMonthsBetween(joiningDate);
            
            // Determine if employee can apply for leave (after 6 months)
            const canApplyLeave = monthsCompleted >= 6;

            // Update the employee record
            const { error: updateError } = await supabase
                .from('employees')
                .update({
                    joining_month_count: monthsCompleted,
                    can_apply_leave: canApplyLeave,
                    updated_at: new Date().toISOString()
                })
                .eq('employee_id', employeeId);

            if (updateError) throw updateError;

            console.log(`✅ Updated ${employeeId}: months=${monthsCompleted}, canApply=${canApplyLeave}`);
            
            return { 
                success: true,
                employee_id: employeeId,
                name: `${employee.first_name} ${employee.last_name}`,
                months_completed: monthsCompleted,
                can_apply_leave: canApplyLeave
            };

        } catch (error) {
            console.error(`❌ Error updating months for employee ${employeeId}:`, error);
            throw error;
        }
    }

    /**
     * Update all employees' joining_month_count
     * @returns {Promise<Object>} Results object
     */

    static async updateAllEmployeesMonths() {
        try {
            const { data: employees, error } = await supabase
                .from('employees')
                .select('employee_id, joining_date, first_name, last_name');

            if (error) throw error;

            console.log(`📊 Updating months for ${employees?.length || 0} employees...`);
            
            const results = {
                total: employees?.length || 0,
                updated: 0,
                failed: 0,
                details: []
            };
            
            for (const emp of employees || []) {
                try {
                    const monthsCompleted = this.calculateMonthsBetween(emp.joining_date);
                    const canApplyLeave = monthsCompleted >= 6;
                    
                    const { error: updateError } = await supabase
                        .from('employees')
                        .update({
                            joining_month_count: monthsCompleted,
                            can_apply_leave: canApplyLeave,
                            updated_at: new Date().toISOString()
                        })
                        .eq('employee_id', emp.employee_id);

                    if (updateError) throw updateError;
                    
                    results.updated++;
                    results.details.push({
                        employee_id: emp.employee_id,
                        name: `${emp.first_name} ${emp.last_name}`,
                        months: monthsCompleted,
                        can_apply: canApplyLeave,
                        status: 'updated'
                    });
                    
                } catch (empError) {
                    results.failed++;
                    results.details.push({
                        employee_id: emp.employee_id,
                        name: emp.first_name ? `${emp.first_name} ${emp.last_name}` : emp.employee_id,
                        error: empError.message,
                        status: 'failed'
                    });
                    console.error(`❌ Error updating ${emp.employee_id}:`, empError.message);
                }
            }
            
            console.log(`✅ Updated ${results.updated} employees, ${results.failed} failed`);
            return results;

        } catch (error) {
            console.error('❌ Error updating all employees:', error);
            throw error;
        }
    }

    /**
     * Initialize for new employee
     * @param {string} employeeId - Employee ID
     * @param {string|Date} joiningDate - Joining date
     * @returns {Promise<Object>} Initialization result
     */

    static async initializeNewEmployee(employeeId, joiningDate) {
        try {
            const monthsCompleted = this.calculateMonthsBetween(joiningDate);
            const canApplyLeave = monthsCompleted >= 6;
            
            const { error } = await supabase
                .from('employees')
                .update({
                    joining_month_count: monthsCompleted,
                    can_apply_leave: canApplyLeave,
                    updated_at: new Date().toISOString()
                })
                .eq('employee_id', employeeId);

            if (error) throw error;
            
            console.log(`✅ Initialized new employee ${employeeId}: months=${monthsCompleted}`);
            
            return { 
                success: true,
                employee_id: employeeId,
                months_completed: monthsCompleted,
                can_apply_leave: canApplyLeave
            };

        } catch (error) {
            console.error(`❌ Error initializing employee ${employeeId}:`, error);
            throw error;
        }
    }

    /**
     * Get employees eligible for leave (completed 6 months)
     * @returns {Promise<Array>} List of eligible employees
     */

    static async getEligibleEmployees() {
        try {
            const { data: employees, error } = await supabase
                .from('employees')
                .select('employee_id, first_name, last_name, joining_date, joining_month_count')
                .gte('joining_month_count', 6);

            if (error) throw error;

            return employees || [];
        } catch (error) {
            console.error('❌ Error getting eligible employees:', error);
            throw error;
        }
    }

    /**
     * Get employees by months of service
     * @param {number} months - Minimum months
     * @returns {Promise<Array>} List of employees
     */

    static async getEmployeesByMonths(months) {
        try {
            const { data: employees, error } = await supabase
                .from('employees')
                .select('employee_id, first_name, last_name, joining_date, joining_month_count')
                .gte('joining_month_count', months)
                .order('joining_month_count', { ascending: false });

            if (error) throw error;

            return employees || [];
        } catch (error) {
            console.error(`❌ Error getting employees with ${months}+ months:`, error);
            throw error;
        }
    }

    /**
     * Get today's work anniversaries
     * @returns {Promise<Array>} List of employees with anniversary today
     */

    static async getTodayAnniversaries() {
        try {
            const today = new Date();
            const todayMonth = today.getMonth() + 1;
            const todayDay = today.getDate();

            const { data: employees, error } = await supabase
                .from('employees')
                .select('employee_id, first_name, last_name, joining_date, department, designation, profile_image')
                .filter('joining_date', 'like', `%-${String(todayMonth).padStart(2, '0')}-${String(todayDay).padStart(2, '0')}`);

            if (error) throw error;

            // Calculate years for each anniversary
            const anniversaries = (employees || []).map(emp => ({
                ...emp,
                years: this.calculateYearsBetween(emp.joining_date, today)
            })).filter(emp => emp.years > 0); // Only if at least 1 year

            return anniversaries;
        } catch (error) {
            console.error('❌ Error getting today anniversaries:', error);
            throw error;
        }
    }

    /**
     * Get today's birthdays
     * @returns {Promise<Array>} List of employees with birthday today
     */

    static async getTodayBirthdays() {
        try {
            const today = new Date();
            const todayMonth = today.getMonth() + 1;
            const todayDay = today.getDate();

            const { data: employees, error } = await supabase
                .from('employees')
                .select('employee_id, first_name, last_name, dob, department, designation, profile_image')
                .filter('dob', 'like', `%-${String(todayMonth).padStart(2, '0')}-${String(todayDay).padStart(2, '0')}`);

            if (error) throw error;

            return employees || [];
        } catch (error) {
            console.error('❌ Error getting today birthdays:', error);
            throw error;
        }
    }

    /**
     * Check if employee can apply for leave
     * @param {string} employeeId - Employee ID
     * @returns {Promise<boolean>} Whether employee can apply
     */
    
    static async canApplyLeave(employeeId) {
        try {
            const { data: employee, error } = await supabase
                .from('employees')
                .select('joining_month_count')
                .eq('employee_id', employeeId)
                .maybeSingle();

            if (error) throw error;

            return employee ? employee.joining_month_count >= 6 : false;
        } catch (error) {
            console.error(`❌ Error checking leave eligibility for ${employeeId}:`, error);
            return false;
        }
    }
}

module.exports = EmployeeService;