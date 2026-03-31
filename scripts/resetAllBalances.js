const supabase = require('../config/supabase');

async function resetAllBalances() {
    console.log('='.repeat(70));
    console.log('🔄 RESETTING ALL LEAVE BALANCES');
    console.log('='.repeat(70));
    
    try {
        const currentYear = new Date().getFullYear();
        
        console.log(`📅 Target year: ${currentYear}`);
        console.log('='.repeat(70));

        // First, backup existing balances (optional)
        try {
            const { data: oldBalances, error: backupError } = await supabase
                .from('leave_balance')
                .select('*');

            if (!backupError && oldBalances && oldBalances.length > 0) {
                console.log(`📦 Backing up ${oldBalances.length} existing balance records...`);
                
                const { error: insertError } = await supabase
                    .from('leave_balance_backup')
                    .insert(oldBalances.map(b => ({
                        ...b,
                        backed_up_at: new Date().toISOString()
                    })));

                if (insertError) {
                    console.log('⚠️ Could not backup to backup table:', insertError.message);
                } else {
                    console.log('✅ Backup created in leave_balance_backup table');
                }
            }
        } catch (backupError) {
            console.log('⚠️ Backup skipped:', backupError.message);
        }

        // Delete all existing transactions
        console.log('🗑️ Deleting existing leave transactions...');
        const { error: transDeleteError } = await supabase
            .from('leave_transactions')
            .delete()
            .neq('id', 0); // Delete all

        if (transDeleteError) {
            console.error('❌ Error deleting transactions:', transDeleteError.message);
        } else {
            console.log('✅ All transactions deleted');
        }

        // Delete all existing balances
        console.log('🗑️ Deleting existing leave balances...');
        const { error: balanceDeleteError } = await supabase
            .from('leave_balance')
            .delete()
            .neq('id', 0); // Delete all

        if (balanceDeleteError) {
            console.error('❌ Error deleting balances:', balanceDeleteError.message);
        } else {
            console.log('✅ All balances deleted');
        }

        // Get all employees
        const { data: employees, error: empError } = await supabase
            .from('employees')
            .select('employee_id, joining_date, first_name, last_name');

        if (empError) throw empError;

        console.log(`\n📊 Creating balances for ${employees?.length || 0} employees in ${currentYear}`);
        console.log('='.repeat(70));

        const results = {
            total: employees?.length || 0,
            successful: 0,
            failed: 0,
            details: []
        };

        for (const emp of employees || []) {
            try {
                const joiningDate = new Date(emp.joining_date);
                const joinYear = joiningDate.getFullYear();
                const joinMonth = joiningDate.getMonth() + 1;
                
                const today = new Date();
                const currentMonth = today.getMonth() + 1;
                const currentDay = today.getDate();
                
                let completedMonths = 0;
                
                if (currentYear > joinYear) {
                    // Joined in previous year
                    for (let m = 1; m <= currentMonth; m++) {
                        if (m < currentMonth) {
                            completedMonths++;
                        } else if (m === currentMonth) {
                            const lastDay = new Date(currentYear, m, 0).getDate();
                            if (currentDay > lastDay) {
                                completedMonths++;
                            }
                        }
                    }
                } else if (currentYear === joinYear) {
                    // Joined in current year
                    for (let m = joinMonth; m <= currentMonth; m++) {
                        if (m < currentMonth) {
                            completedMonths++;
                        } else if (m === currentMonth) {
                            const lastDay = new Date(currentYear, m, 0).getDate();
                            if (currentDay > lastDay) {
                                completedMonths++;
                            }
                        }
                    }
                }
                
                const accrued = completedMonths * 1.5;

                // Insert new balance
                const { error: insertError } = await supabase
                    .from('leave_balance')
                    .insert([{
                        employee_id: emp.employee_id,
                        leave_year: currentYear,
                        total_accrued: accrued,
                        total_used: 0,
                        total_pending: 0,
                        current_balance: accrued,
                        last_updated: new Date().toISOString()
                    }]);

                if (insertError) throw insertError;

                results.successful++;
                results.details.push({
                    employee_id: emp.employee_id,
                    name: `${emp.first_name} ${emp.last_name}`,
                    months: completedMonths,
                    accrued: accrued
                });

                console.log(`✅ ${emp.employee_id} (${emp.first_name} ${emp.last_name}): ${completedMonths} months → ${accrued} leaves`);

                // Add a small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 50));

            } catch (empError) {
                results.failed++;
                results.details.push({
                    employee_id: emp.employee_id,
                    name: emp.first_name ? `${emp.first_name} ${emp.last_name}` : emp.employee_id,
                    error: empError.message
                });
                console.error(`❌ Error for ${emp.employee_id}:`, empError.message);
            }
        }

        console.log('='.repeat(70));
        console.log('📊 RESET SUMMARY');
        console.log(`Total employees: ${results.total}`);
        console.log(`Successful: ${results.successful}`);
        console.log(`Failed: ${results.failed}`);
        console.log('='.repeat(70));

        // Create some initial transactions for audit trail
        if (results.successful > 0) {
            console.log('\n📝 Creating initial transactions...');
            
            const transactions = results.details
                .filter(d => d.accrued > 0)
                .map(d => ({
                    employee_id: d.employee_id,
                    leave_year: currentYear,
                    transaction_date: new Date().toISOString().split('T')[0],
                    transaction_type: 'initial_reset',
                    amount: d.accrued,
                    description: `Initial balance reset for year ${currentYear}`
                }));

            if (transactions.length > 0) {
                const { error: transError } = await supabase
                    .from('leave_transactions')
                    .insert(transactions);

                if (transError) {
                    console.log('⚠️ Could not create transactions:', transError.message);
                } else {
                    console.log(`✅ Created ${transactions.length} transaction records`);
                }
            }
        }

        // Log to reset_log table if exists
        try {
            const { error: logError } = await supabase
                .from('reset_log')
                .insert([{
                    type: 'leave_balance_reset',
                    year: currentYear,
                    executed_at: new Date().toISOString(),
                    summary: {
                        total: results.total,
                        successful: results.successful,
                        failed: results.failed
                    }
                }]);

            if (!logError) {
                console.log('📝 Reset logged to reset_log table');
            }
        } catch (logError) {
            console.log('⚠️ Could not log reset (reset_log table may not exist)');
        }

        console.log('='.repeat(70));
        console.log('✅ ALL BALANCES RESET SUCCESSFULLY!');
        console.log('='.repeat(70));

    } catch (error) {
        console.error('❌ Error resetting balances:', error);
        console.error('Error stack:', error.stack);
    } finally {
        // Uncomment to exit when done
        // process.exit();
    }
}

// Optional: Create backup table if it doesn't exist
async function createBackupTable() {
    const { error } = await supabase.query(`
        CREATE TABLE IF NOT EXISTS leave_balance_backup (
            LIKE leave_balance INCLUDING ALL,
            backed_up_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
    `);

    if (error) {
        console.log('⚠️ Could not create backup table:', error.message);
    }
}

// Run the reset
resetAllBalances();

module.exports = { resetAllBalances };