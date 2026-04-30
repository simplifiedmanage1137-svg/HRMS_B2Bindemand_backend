// backend/controllers/ratingController.js
const supabase = require('../config/supabase');

// Helper functions remain same...
const normalizeName = (value) => {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
};

const getEmployeeById = async (employeeId) => {
    if (!employeeId) return null;
    const { data, error } = await supabase
        .from('employees')
        .select('employee_id, first_name, last_name, reporting_manager, role')
        .eq('employee_id', employeeId)
        .maybeSingle();
    if (error) {
        console.error(`❌ Error fetching employee ${employeeId}:`, error);
        return null;
    }
    return data;
};

const getTeamEmployeeIdsByManagerName = async (managerName) => {
    if (!managerName) return [];
    const { data, error } = await supabase
        .from('employees')
        .select('employee_id, reporting_manager');
    if (error || !data) {
        console.error('❌ Error fetching team members for manager:', error);
        return [];
    }
    const normalizedManager = normalizeName(managerName);
    return (data || [])
        .filter(emp => normalizeName(emp.reporting_manager) === normalizedManager)
        .map(emp => emp.employee_id);
};

// ✅ UPDATED: Get team members for rating (for managers)
const getTeamForRating = async (req, res) => {
    try {
        const managerEmployeeId = req.user?.employeeId;
        const userRole = req.user?.role;

        if (!managerEmployeeId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        // Only managers can access this endpoint
        if (userRole !== 'manager' && userRole !== 'admin') {
            return res.status(403).json({ success: false, message: 'Only managers can rate team members' });
        }

        // Get manager details
        const manager = await getEmployeeById(managerEmployeeId);
        if (!manager) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const managerName = `${manager.first_name || ''} ${manager.last_name || ''}`.trim().toLowerCase();

        // Get all team members (employees reporting to this manager)
        const teamEmployeeIds = await getTeamEmployeeIdsByManagerName(managerName);

        if (teamEmployeeIds.length === 0) {
            return res.json({
                success: true,
                team_members: [],
                current_month: new Date().getMonth() + 1,
                current_year: new Date().getFullYear(),
                month_name: new Date().toLocaleString('default', { month: 'long' }),
                message: 'No team members found'
            });
        }

        // Get team member details
        const { data: teamMembers, error: teamError } = await supabase
            .from('employees')
            .select('employee_id, first_name, last_name, department, designation, joining_date')
            .in('employee_id', teamEmployeeIds)
            .order('first_name', { ascending: true });

        if (teamError) throw teamError;

        // Get current month and year
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();

        // Get existing ratings for current month (only from managers, not admin)
        let existingRatings = [];
        if (teamMembers && teamMembers.length > 0) {
            const { data: ratings, error: ratingError } = await supabase
                .from('employee_ratings')
                .select('*')
                .in('employee_id', teamMembers.map(m => m.employee_id))
                .eq('rating_month', currentMonth)
                .eq('rating_year', currentYear)
                .eq('rated_by_role', 'manager'); // Only show manager ratings

            if (!ratingError) {
                existingRatings = ratings || [];
            }
        }

        // Combine team members with their ratings
        const teamWithRatings = (teamMembers || []).map(member => {
            const existingRating = existingRatings?.find(r => r.employee_id === member.employee_id);
            return {
                ...member,
                rating: existingRating?.rating || null,
                comments: existingRating?.comments || null,
                rating_id: existingRating?.id || null,
                has_rated: !!existingRating
            };
        });

        res.json({
            success: true,
            team_members: teamWithRatings,
            current_month: currentMonth,
            current_year: currentYear,
            month_name: now.toLocaleString('default', { month: 'long' })
        });

    } catch (error) {
        console.error('❌ Error fetching team for rating:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ✅ UPDATED: Submit rating (supports both manager and admin)
const submitRating = async (req, res) => {
    try {
        const { employee_id, rating, comments, rating_month, rating_year } = req.body;
        const raterId = req.user?.employeeId;
        const userRole = req.user?.role;

        if (!raterId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        if (!employee_id || !rating || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: 'Valid rating (1-5) is required' });
        }

        const ratedByRole = userRole === 'admin' ? 'admin' : 'manager';

        // For managers: Verify the employee is in their team
        if (userRole === 'manager') {
            const manager = await getEmployeeById(raterId);
            if (!manager) {
                return res.status(404).json({ success: false, message: 'Manager not found' });
            }

            const managerName = `${manager.first_name || ''} ${manager.last_name || ''}`.trim().toLowerCase();
            const teamEmployeeIds = await getTeamEmployeeIdsByManagerName(managerName);

            if (!teamEmployeeIds.includes(employee_id)) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only rate your own team members'
                });
            }
        }
        // For admins: Can rate any employee (no restriction)

        const month = rating_month || new Date().getMonth() + 1;
        const year = rating_year || new Date().getFullYear();

        // Check if rating already exists from this rater for this month/year
        const { data: existingRating, error: checkError } = await supabase
            .from('employee_ratings')
            .select('id')
            .eq('employee_id', employee_id)
            .eq('rating_month', month)
            .eq('rating_year', year)
            .eq('rated_by_role', ratedByRole)
            .maybeSingle();

        let result;

        if (existingRating) {
            // Update existing rating
            const { data, error } = await supabase
                .from('employee_ratings')
                .update({
                    rating,
                    comments,
                    updated_at: new Date()
                })
                .eq('id', existingRating.id)
                .select();

            if (error) throw error;
            result = data;
        } else {
            // Insert new rating
            const { data, error } = await supabase
                .from('employee_ratings')
                .insert([{
                    employee_id,
                    manager_id: raterId,
                    rating,
                    comments,
                    rating_month: month,
                    rating_year: year,
                    rated_by_role: ratedByRole
                }])
                .select();

            if (error) throw error;
            result = data;
        }

        res.json({
            success: true,
            message: existingRating ? 'Rating updated successfully' : 'Rating submitted successfully',
            rating: result[0]
        });

    } catch (error) {
        console.error('Error submitting rating:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ✅ UPDATED: Get rating history for employee (shows both manager and admin ratings separately)
const getEmployeeRatingHistory = async (req, res) => {
    try {
        const { employee_id } = req.params;
        const requestingEmployeeId = req.user?.employeeId;
        const userRole = req.user?.role;

        // Check authorization
        if (requestingEmployeeId !== employee_id && userRole !== 'admin') {
            // Check if requester is the manager of this employee
            const requester = await getEmployeeById(requestingEmployeeId);
            if (requester) {
                const requesterName = `${requester.first_name || ''} ${requester.last_name || ''}`.trim().toLowerCase();
                const teamEmployeeIds = await getTeamEmployeeIdsByManagerName(requesterName);

                if (!teamEmployeeIds.includes(employee_id)) {
                    return res.status(403).json({ success: false, message: 'Access denied' });
                }
            } else {
                return res.status(403).json({ success: false, message: 'Access denied' });
            }
        }

        // Get all ratings for employee (both manager and admin)
        const { data: ratings, error } = await supabase
            .from('employee_ratings')
            .select('*')
            .eq('employee_id', employee_id)
            .order('rating_year', { ascending: false })
            .order('rating_month', { ascending: false });

        if (error) throw error;

        // Separate ratings by role
        const managerRatings = [];
        const adminRatings = [];

        for (const rating of (ratings || [])) {
            // Fetch rater details
            const { data: rater, error: raterError } = await supabase
                .from('employees')
                .select('first_name, last_name, role')
                .eq('employee_id', rating.manager_id)
                .maybeSingle();

            let raterName = 'Unknown';
            let raterRole = rating.rated_by_role || 'manager';

            if (rater && !raterError) {
                raterName = `${rater.first_name || ''} ${rater.last_name || ''}`.trim();
                raterRole = rater.role || rating.rated_by_role || 'manager';
            }

            const ratingData = {
                id: rating.id,
                rating: rating.rating,
                rating_label: getRatingLabel(rating.rating),
                comments: rating.comments,
                month: rating.rating_month,
                year: rating.rating_year,
                month_name: new Date(rating.rating_year, rating.rating_month - 1).toLocaleString('default', { month: 'long' }),
                rater_name: raterName,
                rater_role: raterRole === 'admin' ? 'Admin' : 'Manager',
                created_at: rating.created_at
            };

            if (raterRole === 'admin' || rating.rated_by_role === 'admin') {
                adminRatings.push(ratingData);
            } else {
                managerRatings.push(ratingData);
            }
        }

        // Calculate averages separately
        const managerAvg = managerRatings.length > 0
            ? (managerRatings.reduce((sum, r) => sum + r.rating, 0) / managerRatings.length).toFixed(1)
            : null;

        const adminAvg = adminRatings.length > 0
            ? (adminRatings.reduce((sum, r) => sum + r.rating, 0) / adminRatings.length).toFixed(1)
            : null;

        res.json({
            success: true,
            manager_ratings: managerRatings,
            admin_ratings: adminRatings,
            manager_average: managerAvg,
            admin_average: adminAvg,
            total_manager_ratings: managerRatings.length,
            total_admin_ratings: adminRatings.length
        });

    } catch (error) {
        console.error('❌ Error fetching rating history:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ✅ UPDATED: Get all ratings for admin (shows all ratings)
const getAllRatings = async (req, res) => {
    try {
        const userRole = req.user?.role;

        if (userRole !== 'admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        const { month, year, employee_id, rating_type } = req.query;

        let query = supabase
            .from('employee_ratings')
            .select('*')
            .order('rating_year', { ascending: false })
            .order('rating_month', { ascending: false });

        if (month && year) {
            query = query.eq('rating_month', parseInt(month)).eq('rating_year', parseInt(year));
        }

        if (employee_id) {
            query = query.eq('employee_id', employee_id);
        }

        if (rating_type && rating_type !== 'all') {
            query = query.eq('rated_by_role', rating_type);
        }

        const { data: ratings, error } = await query;

        if (error) throw error;

        // Fetch employee and rater details for each rating
        const formattedRatings = [];
        for (const rating of (ratings || [])) {
            // Fetch employee details
            const { data: employee, error: empError } = await supabase
                .from('employees')
                .select('first_name, last_name, department, reporting_manager')
                .eq('employee_id', rating.employee_id)
                .maybeSingle();

            // Fetch rater details
            const { data: rater, error: mgrError } = await supabase
                .from('employees')
                .select('first_name, last_name, role')
                .eq('employee_id', rating.manager_id)
                .maybeSingle();

            formattedRatings.push({
                id: rating.id,
                employee_id: rating.employee_id,
                employee_name: employee ? `${employee.first_name || ''} ${employee.last_name || ''}`.trim() : 'Unknown',
                department: employee?.department,
                reporting_manager: employee?.reporting_manager,
                rating: rating.rating,
                rating_label: getRatingLabel(rating.rating),
                comments: rating.comments,
                month: rating.rating_month,
                year: rating.rating_year,
                month_name: new Date(rating.rating_year, rating.rating_month - 1).toLocaleString('default', { month: 'long' }),
                rater_id: rating.manager_id,
                rater_name: rater ? `${rater.first_name || ''} ${rater.last_name || ''}`.trim() : 'Unknown',
                rater_role: rating.rated_by_role === 'admin' ? 'Admin' : (rater?.role === 'admin' ? 'Admin' : 'Manager'),
                created_at: rating.created_at,
                updated_at: rating.updated_at
            });
        }

        res.json({
            success: true,
            ratings: formattedRatings,
            total: formattedRatings.length
        });

    } catch (error) {
        console.error('❌ Error fetching all ratings:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Helper functions
function getRatingLabel(rating) {
    if (rating === 5) return 'Excellent';
    if (rating === 4) return 'Good';
    if (rating === 3) return 'Average';
    if (rating === 2) return 'Below Average';
    if (rating === 1) return 'Poor';
    return 'Not Rated';
}

// In backend/controllers/ratingController.js

const adminRateEmployee = async (req, res) => {
    try {
        const { employee_id, rating, comments, rating_month, rating_year } = req.body;
        const adminId = req.user?.employeeId;
        const userRole = req.user?.role;

        if (userRole !== 'admin') {
            return res.status(403).json({ success: false, message: 'Only admins can use this endpoint' });
        }

        if (!employee_id || !rating || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: 'Valid rating (1-5) is required' });
        }

        const month = rating_month || new Date().getMonth() + 1;
        const year = rating_year || new Date().getFullYear();

        // Check if admin already rated this employee this month
        const { data: existingRating, error: checkError } = await supabase
            .from('employee_ratings')
            .select('id')
            .eq('employee_id', employee_id)
            .eq('rating_month', month)
            .eq('rating_year', year)
            .eq('rated_by_role', 'admin')
            .maybeSingle();

        let result;

        if (existingRating) {
            // ✅ UPDATE existing rating
            const { data, error } = await supabase
                .from('employee_ratings')
                .update({
                    rating: rating,
                    comments: comments || null,
                    updated_at: new Date()
                })
                .eq('id', existingRating.id)
                .select();

            if (error) throw error;
            result = data;

            console.log(`✅ Updated admin rating for employee ${employee_id} (Month: ${month}/${year})`);
        } else {
            // ✅ INSERT new rating
            const { data, error } = await supabase
                .from('employee_ratings')
                .insert([{
                    employee_id,
                    manager_id: adminId,
                    rating,
                    comments: comments || null,
                    rating_month: month,
                    rating_year: year,
                    rated_by_role: 'admin'
                }])
                .select();

            if (error) throw error;
            result = data;

            console.log(`✅ Inserted new admin rating for employee ${employee_id} (Month: ${month}/${year})`);
        }

        res.json({
            success: true,
            message: existingRating ? 'Admin rating updated successfully' : 'Admin rating submitted successfully',
            rating: result[0]
        });

    } catch (error) {
        console.error('❌ Error in adminRateEmployee:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getTeamForRating,
    submitRating,
    getEmployeeRatingHistory,
    getAllRatings,
    adminRateEmployee
};