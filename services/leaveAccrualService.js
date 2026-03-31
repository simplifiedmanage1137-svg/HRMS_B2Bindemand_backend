const supabase = require('../config/supabase');

class LeaveAccrualService {
    
    /**
     * Add monthly leave accrual for all eligible employees
     * @returns {Promise<Object>} Result of accrual operation
     */
    static async addMonthlyAccrual() {
        try {
            console.log('='.repeat(70));
            console.log('🔄 RUNNING MONTHLY LEAVE ACCRUAL');
            console.log('='.repeat(70));
            
            const today = new Date();
            const currentYear = today.getFullYear();
            const currentMonth = today.getMonth() + 1;
            const monthName = today.toLocaleString('default', { month: 'long' });
            
            console.log(`📅 Processing accrual for ${monthName} ${currentYear}`);

            // Check if accrual already done for this month
            const { data: existingAccrual, error: checkError } = await supabase
                .from('leave_transactions')
                .select('id')
                .eq('transaction_type', 'accrual')
                .gte('transaction_date', `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`)
                .lt('transaction_date', `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`)
                .limit(1);

            if (checkError) throw checkError;

            if (existingAccrual && existingAccrual.length > 0) {
                console.log('⚠️ Monthly accrual already done for this month');
                return { 
                    success: false, 
                    message: 'Already accrued this month' 
                };
            }

            // Get all employees who have completed 6 months
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

            const { data: employees, error: empError } = await supabase
                .from('employees')
                .select('employee_id, joining_date, first_name, last_name')
                .lte('joining_date', sixMonthsAgo.toISOString().split('T')[0]);

            if (empError) throw empError;

            console.log(`📊 Found ${employees?.length || 0} eligible employees (joined before ${sixMonthsAgo.toISOString().split('T')[0]})`);

            const results = {
                total: employees?.length || 0,
                successful: 0,
                failed: 0,
                skipped: 0,
                details: []
            };

            for (const emp of employees || []) {
                try {
                    console.log(`\n📋 Processing: ${emp.employee_id} (${emp.first_name} ${emp.last_name})`);

                    // Check if already accrued for this month (double-check per employee)
                    const { data: empAccrual, error: empCheckError } = await supabase
                        .from('leave_transactions')
                        .select('id')
                        .eq('employee_id', emp.employee_id)
                        .eq('transaction_type', 'accrual')
                        .gte('transaction_date', `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`)
                        .lt('transaction_date', `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`);

                    if (empCheckError) throw empCheckError;

                    if (empAccrual && empAccrual.length > 0) {
                        results.skipped++;
                        results.details.push({
                            employee_id: emp.employee_id,
                            name: `${emp.first_name} ${emp.last_name}`,
                            status: 'skipped',
                            message: `Already accrued for ${monthName}`
                        });
                        console.log(`   ⏭️ Already accrued for ${monthName}`);
                        continue;
                    }

                    // Get current balance
                    const { data: balance, error: balanceError } = await supabase
                        .from('leave_balance')
                        .select('*')
                        .eq('employee_id', emp.employee_id)
                        .eq('leave_year', currentYear)
                        .maybeSingle();

                    if (balanceError) throw balanceError;

                    if (!balance) {
                        // Create new balance record
                        const { error: createError } = await supabase
                            .from('leave_balance')
                            .insert([{
                                employee_id: emp.employee_id,
                                leave_year: currentYear,
                                total_accrued: 1.5,
                                total_used: 0,
                                total_pending: 0,
                                current_balance: 1.5,
                                last_updated: today.toISOString()
                            }]);

                        if (createError) throw createError;
                    } else {
                        // Update existing balance
                        const newAccrued = (parseFloat(balance.total_accrued) || 0) + 1.5;
                        const newCurrent = (parseFloat(balance.current_balance) || 0) + 1.5;

                        const { error: updateError } = await supabase
                            .from('leave_balance')
                            .update({
                                total_accrued: newAccrued,
                                current_balance: newCurrent,
                                last_updated: today.toISOString()
                            })
                            .eq('employee_id', emp.employee_id)
                            .eq('leave_year', currentYear);

                        if (updateError) throw updateError;
                    }

                    // Record transaction
                    const { error: transError } = await supabase
                        .from('leave_transactions')
                        .insert([{
                            employee_id: emp.employee_id,
                            leave_year: currentYear,
                            transaction_date: today.toISOString().split('T')[0],
                            transaction_type: 'accrual',
                            amount: 1.5,
                            description: `Monthly leave accrual for ${monthName} ${currentYear}`
                        }]);

                    if (transError) throw transError;

                    results.successful++;
                    results.details.push({
                        employee_id: emp.employee_id,
                        name: `${emp.first_name} ${emp.last_name}`,
                        status: 'success',
                        amount: 1.5,
                        month: monthName
                    });

                    console.log(`   ✅ Added 1.5 leaves for ${monthName}`);

                    // Create notification
                    try {
                        await supabase
                            .from('notifications')
                            .insert([{
                                employee_id: emp.employee_id,
                                title: 'Leave Accrual',
                                message: `1.5 leaves have been added to your account for ${monthName} ${currentYear}.`,
                                type: 'leave_accrual',
                                created_at: today.toISOString()
                            }]);
                    } catch (notifError) {
                        console.log(`   ⚠️ Could not create notification: ${notifError.message}`);
                    }

                    // Small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 50));

                } catch (empError) {
                    results.failed++;
                    results.details.push({
                        employee_id: emp.employee_id,
                        name: emp.first_name ? `${emp.first_name} ${emp.last_name}` : emp.employee_id,
                        status: 'failed',
                        error: empError.message
                    });
                    console.error(`   ❌ Error:`, empError.message);
                }
            }

            console.log('\n' + '='.repeat(70));
            console.log('📊 ACCRUAL SUMMARY');
            console.log(`Month: ${monthName} ${currentYear}`);
            console.log(`Total eligible: ${results.total}`);
            console.log(`Successful: ${results.successful}`);
            console.log(`Skipped: ${results.skipped}`);
            console.log(`Failed: ${results.failed}`);
            console.log('='.repeat(70));

            return { 
                success: true, 
                message: `Monthly accrual for ${monthName} ${currentYear} completed`,
                summary: {
                    total: results.total,
                    successful: results.successful,
                    skipped: results.skipped,
                    failed: results.failed
                },
                details: results.details
            };

        } catch (error) {
            console.error('❌ Error in monthly accrual:', error);
            throw error;
        }
    }

    /**
     * Initialize leave balance for new employee
     * @param {string} employee_id - Employee ID
     * @param {string} joiningDate - Joining date
     * @returns {Promise<Object>} Initialized balance
     */
    static async initializeEmployeeBalance(employee_id, joiningDate) {
        try {
            console.log(`🔄 Initializing leave balance for employee ${employee_id}`);
            
            const today = new Date();
            const currentYear = today.getFullYear();
            const joinDate = new Date(joiningDate);
            
            // Calculate months passed
            const monthsPassed = (today.getFullYear() - joinDate.getFullYear()) * 12 + 
                                (today.getMonth() - joinDate.getMonth());
            
            // Adjust for day of month
            if (today.getDate() < joinDate.getDate()) {
                monthsPassed--;
            }

            console.log(`📊 Months passed since joining: ${monthsPassed}`);
            
            // Calculate accrued leaves (only after 6 months)
            let accruedLeaves = 0;
            let eligibleMonths = 0;
            
            if (monthsPassed >= 6) {
                eligibleMonths = monthsPassed - 5; // Months after 6-month probation
                accruedLeaves = eligibleMonths * 1.5;
            }

            console.log(`📊 Eligible months: ${eligibleMonths}, Accrued leaves: ${accruedLeaves}`);

            // Check if balance already exists
            const { data: existing, error: checkError } = await supabase
                .from('leave_balance')
                .select('id')
                .eq('employee_id', employee_id)
                .eq('leave_year', currentYear)
                .maybeSingle();

            if (checkError) throw checkError;

            if (existing) {
                console.log(`⚠️ Balance already exists for ${employee_id} in ${currentYear}`);
                return {
                    success: false,
                    message: 'Balance already exists',
                    employee_id,
                    year: currentYear
                };
            }

            // Create balance record
            const { error: createError } = await supabase
                .from('leave_balance')
                .insert([{
                    employee_id,
                    leave_year: currentYear,
                    total_accrued: accruedLeaves,
                    total_used: 0,
                    total_pending: 0,
                    current_balance: accruedLeaves,
                    last_updated: today.toISOString()
                }]);

            if (createError) throw createError;

            // Add transaction records for past accruals
            if (accruedLeaves > 0) {
                const transactions = [];
                
                for (let i = 0; i < eligibleMonths; i++) {
                    const accrualDate = new Date(joinDate);
                    accrualDate.setMonth(joinDate.getMonth() + 6 + i);
                    
                    transactions.push({
                        employee_id,
                        leave_year: accrualDate.getFullYear(),
                        transaction_date: accrualDate.toISOString().split('T')[0],
                        transaction_type: 'accrual',
                        amount: 1.5,
                        description: `Monthly leave accrual for ${accrualDate.toLocaleString('default', { month: 'long' })} ${accrualDate.getFullYear()}`
                    });
                }

                const { error: transError } = await supabase
                    .from('leave_transactions')
                    .insert(transactions);

                if (transError) throw transError;

                console.log(`✅ Created ${transactions.length} past transaction records`);
            }

            console.log(`✅ Initialized leave balance for employee ${employee_id} with ${accruedLeaves} leaves`);
            
            return {
                success: true,
                employee_id,
                year: currentYear,
                total_accrued: accruedLeaves,
                available: accruedLeaves,
                months_eligible: eligibleMonths
            };

        } catch (error) {
            console.error('❌ Error initializing employee balance:', error);
            throw error;
        }
    }

    /**
     * Add manual accrual for specific employee (admin only)
     * @param {string} employee_id - Employee ID
     * @param {number} amount - Amount to accrue
     * @param {string} reason - Reason for manual accrual
     * @returns {Promise<Object>} Result
     */
    static async addManualAccrual(employee_id, amount, reason) {
        try {
            const today = new Date();
            const currentYear = today.getFullYear();
            const monthName = today.toLocaleString('default', { month: 'long' });

            // Get current balance
            const { data: balance, error: balanceError } = await supabase
                .from('leave_balance')
                .select('*')
                .eq('employee_id', employee_id)
                .eq('leave_year', currentYear)
                .maybeSingle();

            if (balanceError) throw balanceError;

            if (!balance) {
                // Create new balance
                const { error: createError } = await supabase
                    .from('leave_balance')
                    .insert([{
                        employee_id,
                        leave_year: currentYear,
                        total_accrued: amount,
                        total_used: 0,
                        total_pending: 0,
                        current_balance: amount,
                        last_updated: today.toISOString()
                    }]);

                if (createError) throw createError;
            } else {
                // Update existing balance
                const newAccrued = (parseFloat(balance.total_accrued) || 0) + amount;
                const newCurrent = (parseFloat(balance.current_balance) || 0) + amount;

                const { error: updateError } = await supabase
                    .from('leave_balance')
                    .update({
                        total_accrued: newAccrued,
                        current_balance: newCurrent,
                        last_updated: today.toISOString()
                    })
                    .eq('employee_id', employee_id)
                    .eq('leave_year', currentYear);

                if (updateError) throw updateError;
            }

            // Record transaction
            const { error: transError } = await supabase
                .from('leave_transactions')
                .insert([{
                    employee_id,
                    leave_year: currentYear,
                    transaction_date: today.toISOString().split('T')[0],
                    transaction_type: 'manual_accrual',
                    amount: amount,
                    description: reason || `Manual accrual for ${monthName} ${currentYear}`
                }]);

            if (transError) throw transError;

            console.log(`✅ Added ${amount} leaves manually to ${employee_id}`);
            
            return {
                success: true,
                employee_id,
                amount,
                current_balance: balance ? (parseFloat(balance.current_balance) + amount) : amount
            };

        } catch (error) {
            console.error('❌ Error adding manual accrual:', error);
            throw error;
        }
    }
}

module.exports = LeaveAccrualService;