const supabase = require('../config/supabase');
const LeaveYearlyService = require('../services/leaveYearlyService');

async function initializeLeaveBalances() {
    console.log('='.repeat(70));
    console.log('🔄 LEAVE BALANCE INITIALIZATION STARTED');
    console.log('='.repeat(70));
    
    try {
        // Get all employees
        const { data: employees, error: empError } = await supabase
            .from('employees')
            .select('employee_id, joining_date, first_name, last_name');

        if (empError) throw empError;

        console.log(`📊 Found ${employees?.length || 0} employees`);
        console.log('='.repeat(70));

        const results = {
            total: employees?.length || 0,
            created: 0,
            updated: 0,
            failed: 0,
            details: []
        };

        const currentYear = new Date().getFullYear();

        for (const emp of employees || []) {
            try {
                const joiningDate = new Date(emp.joining_date);
                const today = new Date();
                
                console.log(`\n📋 Processing: ${emp.employee_id} (${emp.first_name} ${emp.last_name})`);
                console.log(`   Joining Date: ${emp.joining_date}`);

                // Calculate completed months since joining via shared service
                const monthsDiff = LeaveYearlyService.calculateCompletedMonthsFromJoining(joiningDate, today);

                console.log(`   Months completed since joining: ${monthsDiff}`);

                // Calculate accrued leaves (1.5 per month after 6 months)
                let totalAccrued = 0;
                if (monthsDiff >= 6) {
                    const eligibleMonths = monthsDiff - 5; // Months after 6-month probation
                    totalAccrued = eligibleMonths * 1.5;
                }

                // Get used leaves from approved leaves
                const { data: usedLeaves, error: usedError } = await supabase
                    .from('leaves')
                    .select('days_count')
                    .eq('employee_id', emp.employee_id)
                    .eq('status', 'approved');

                if (usedError) throw usedError;

                const used = usedLeaves?.reduce((sum, leave) => sum + (parseFloat(leave.days_count) || 0), 0) || 0;

                // Get pending leaves
                const { data: pendingLeaves, error: pendingError } = await supabase
                    .from('leaves')
                    .select('days_count')
                    .eq('employee_id', emp.employee_id)
                    .eq('status', 'pending');

                if (pendingError) throw pendingError;

                const pending = pendingLeaves?.reduce((sum, leave) => sum + (parseFloat(leave.days_count) || 0), 0) || 0;

                const currentBalance = totalAccrued - used - pending;

                console.log(`   📊 Calculated:`);
                console.log(`      - Accrued: ${totalAccrued.toFixed(1)} days`);
                console.log(`      - Used: ${used.toFixed(1)} days`);
                console.log(`      - Pending: ${pending.toFixed(1)} days`);
                console.log(`      - Current Balance: ${currentBalance.toFixed(1)} days`);

                // Check if balance record exists for current year
                const { data: existing, error: checkError } = await supabase
                    .from('leave_balance')
                    .select('*')
                    .eq('employee_id', emp.employee_id)
                    .eq('leave_year', currentYear)
                    .maybeSingle();

                if (checkError) throw checkError;

                if (existing) {
                    // Update existing record
                    const { error: updateError } = await supabase
                        .from('leave_balance')
                        .update({
                            total_accrued: totalAccrued,
                            total_used: used,
                            total_pending: pending,
                            current_balance: currentBalance,
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
                        old_value: {
                            accrued: existing.total_accrued,
                            used: existing.total_used,
                            pending: existing.total_pending,
                            balance: existing.current_balance
                        },
                        new_value: {
                            accrued: totalAccrued,
                            used: used,
                            pending: pending,
                            balance: currentBalance
                        }
                    });

                    console.log(`   ✅ Updated existing balance`);
                } else {
                    // Insert new record
                    const { error: insertError } = await supabase
                        .from('leave_balance')
                        .insert([{
                            employee_id: emp.employee_id,
                            leave_year: currentYear,
                            total_accrued: totalAccrued,
                            total_used: used,
                            total_pending: pending,
                            current_balance: currentBalance,
                            last_updated: new Date().toISOString()
                        }]);

                    if (insertError) throw insertError;

                    results.created++;
                    results.details.push({
                        employee_id: emp.employee_id,
                        name: `${emp.first_name} ${emp.last_name}`,
                        action: 'created',
                        values: {
                            accrued: totalAccrued,
                            used: used,
                            pending: pending,
                            balance: currentBalance
                        }
                    });

                    console.log(`   ✅ Created new balance`);
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
        console.log('📊 INITIALIZATION SUMMARY');
        console.log(`Total employees: ${results.total}`);
        console.log(`Created: ${results.created}`);
        console.log(`Updated: ${results.updated}`);
        console.log(`Failed: ${results.failed}`);
        console.log('='.repeat(70));

        // Log to initialization_log table if exists
        try {
            await supabase
                .from('initialization_log')
                .insert([{
                    type: 'leave_balance',
                    executed_at: new Date().toISOString(),
                    summary: {
                        total: results.total,
                        created: results.created,
                        updated: results.updated,
                        failed: results.failed
                    },
                    details: results.details
                }]);
            console.log('📝 Results logged to initialization_log table');
        } catch (logError) {
            console.log('⚠️ Could not log results (initialization_log table may not exist)');
        }

        console.log('='.repeat(70));
        console.log('✅ LEAVE BALANCE INITIALIZATION COMPLETED SUCCESSFULLY!');
        console.log('='.repeat(70));

    } catch (error) {
        console.error('❌ Error initializing leave balances:', error);
        console.error('Error stack:', error.stack);
    } finally {
        // Uncomment to exit when done
        // process.exit();
    }
}

// Run the function
initializeLeaveBalances();

// Export for use in other files
module.exports = { initializeLeaveBalances };