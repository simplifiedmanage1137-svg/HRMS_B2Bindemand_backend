const supabase = require('../config/supabase');

async function fixAllBalances() {
    try {
        console.log('='.repeat(70));
        console.log('🔄 FIXING ALL EMPLOYEE LEAVE BALANCES');
        console.log('='.repeat(70));
        
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1;
        const currentDay = today.getDate();

        // Get all employees
        const { data: employees, error: empError } = await supabase
            .from('employees')
            .select('employee_id, joining_date, first_name, last_name');

        if (empError) throw empError;

        console.log(`📊 Found ${employees?.length || 0} employees`);
        console.log(`📅 Current date: ${today.toISOString().split('T')[0]}`);
        console.log(`📅 Current year: ${currentYear}, Month: ${currentMonth}, Day: ${currentDay}`);
        console.log('='.repeat(70));

        const results = {
            total: employees?.length || 0,
            created: 0,
            updated: 0,
            unchanged: 0,
            failed: 0,
            details: []
        };

        for (const emp of employees || []) {
            try {
                const joiningDate = new Date(emp.joining_date);
                const joinYear = joiningDate.getFullYear();
                const joinMonth = joiningDate.getMonth() + 1;

                // Calculate completed months in CURRENT YEAR
                let completedMonths = 0;
                
                if (currentYear > joinYear) {
                    // Joined in previous year - count all completed months in current year
                    for (let month = 1; month <= currentMonth; month++) {
                        if (month < currentMonth) {
                            completedMonths++;
                        } else if (month === currentMonth) {
                            const lastDay = new Date(currentYear, month, 0).getDate();
                            if (currentDay > lastDay) {
                                completedMonths++;
                            }
                        }
                    }
                } else if (currentYear === joinYear) {
                    // Joined in current year - count months from join month
                    for (let month = joinMonth; month <= currentMonth; month++) {
                        if (month < currentMonth) {
                            completedMonths++;
                        } else if (month === currentMonth) {
                            const lastDay = new Date(currentYear, month, 0).getDate();
                            if (currentDay > lastDay) {
                                completedMonths++;
                            }
                        }
                    }
                }

                const expectedAccrued = completedMonths * 1.5;

                console.log(`\n📋 Processing: ${emp.employee_id} (${emp.first_name} ${emp.last_name})`);
                console.log(`   Joining: ${emp.joining_date}, Completed months: ${completedMonths}, Expected accrued: ${expectedAccrued}`);

                // Check if balance exists for current year
                const { data: existing, error: checkError } = await supabase
                    .from('leave_balance')
                    .select('*')
                    .eq('employee_id', emp.employee_id)
                    .eq('leave_year', currentYear)
                    .maybeSingle();

                if (checkError) throw checkError;

                if (!existing) {
                    // Create new balance
                    const { error: createError } = await supabase
                        .from('leave_balance')
                        .insert([{
                            employee_id: emp.employee_id,
                            leave_year: currentYear,
                            total_accrued: expectedAccrued,
                            total_used: 0,
                            total_pending: 0,
                            current_balance: expectedAccrued,
                            last_updated: new Date().toISOString()
                        }]);

                    if (createError) throw createError;

                    results.created++;
                    results.details.push({
                        employee_id: emp.employee_id,
                        name: `${emp.first_name} ${emp.last_name}`,
                        action: 'created',
                        expected: expectedAccrued
                    });
                    
                    console.log(`   ✅ Created balance: ${expectedAccrued} leaves`);

                } else {
                    // Check if update needed
                    const currentAccrued = parseFloat(existing.total_accrued) || 0;
                    
                    if (Math.abs(currentAccrued - expectedAccrued) > 0.01) { // Allow small floating point difference
                        // Calculate new current balance
                        const totalUsed = parseFloat(existing.total_used) || 0;
                        const totalPending = parseFloat(existing.total_pending) || 0;
                        const newCurrentBalance = expectedAccrued - totalUsed - totalPending;

                        const { error: updateError } = await supabase
                            .from('leave_balance')
                            .update({
                                total_accrued: expectedAccrued,
                                current_balance: newCurrentBalance,
                                last_updated: new Date().toISOString()
                            })
                            .eq('employee_id', emp.employee_id)
                            .eq('leave_year', currentYear);

                        if (updateError) throw updateError;

                        results.updated++;
                        results.details.push({
                            employee_id: emp.employee_id,
                            name: `${emp.first_name} ${emp.last_name}`,
                            action: 'updated',
                            old_value: currentAccrued,
                            new_value: expectedAccrued
                        });

                        console.log(`   🔄 Updated balance: ${currentAccrued} → ${expectedAccrued} leaves`);
                    } else {
                        results.unchanged++;
                        results.details.push({
                            employee_id: emp.employee_id,
                            name: `${emp.first_name} ${emp.last_name}`,
                            action: 'unchanged',
                            value: expectedAccrued
                        });

                        console.log(`   ✓ Balance correct: ${expectedAccrued} leaves`);
                    }
                }

                // Add a small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (empError) {
                results.failed++;
                results.details.push({
                    employee_id: emp.employee_id,
                    name: emp.first_name ? `${emp.first_name} ${emp.last_name}` : emp.employee_id,
                    action: 'failed',
                    error: empError.message
                });
                console.error(`   ❌ Error processing ${emp.employee_id}:`, empError.message);
            }
        }

        console.log('='.repeat(70));
        console.log('📊 FIX BALANCES SUMMARY');
        console.log(`Total employees: ${results.total}`);
        console.log(`Created: ${results.created}`);
        console.log(`Updated: ${results.updated}`);
        console.log(`Unchanged: ${results.unchanged}`);
        console.log(`Failed: ${results.failed}`);
        console.log('='.repeat(70));

        // Log to fix_balances_log table if exists
        try {
            await supabase
                .from('fix_balances_log')
                .insert([{
                    executed_at: new Date().toISOString(),
                    summary: {
                        total: results.total,
                        created: results.created,
                        updated: results.updated,
                        unchanged: results.unchanged,
                        failed: results.failed
                    },
                    details: results.details
                }]);
            console.log('📝 Results logged to fix_balances_log table');
        } catch (logError) {
            console.log('⚠️ Could not log results (table may not exist)');
        }

        console.log('='.repeat(70));
        console.log('✅ All balances fixed successfully!');
        console.log('='.repeat(70));

    } catch (error) {
        console.error('❌ Error fixing balances:', error);
        console.error('Error stack:', error.stack);
    } finally {
        // Uncomment if you want the script to exit when done
        // process.exit();
    }
}

// Run the function
fixAllBalances();

// Export for use in other files
module.exports = { fixAllBalances };