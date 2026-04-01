const supabase = require('../config/supabase');
const LeaveYearlyService = require('../services/leaveYearlyService');

async function verifyLeaveBalance(employeeId) {
    console.log('\n' + '='.repeat(70));
    console.log(`🔍 VERIFYING LEAVE BALANCE FOR ${employeeId}`);
    console.log('='.repeat(70) + '\n');
    
    try {
        // Get employee details
        const { data: employees, error: empError } = await supabase
            .from('employees')
            .select('employee_id, first_name, last_name, joining_date')
            .eq('employee_id', employeeId);

        if (empError) throw empError;

        if (!employees || employees.length === 0) {
            console.log('❌ Employee not found');
            return;
        }

        const emp = employees[0];
        const joiningDate = new Date(emp.joining_date);
        const today = new Date();
        
        // Calculate completed months since joining using shared service (month boundaries)
        const monthsCompleted = LeaveYearlyService.calculateCompletedMonthsFromJoining(joiningDate, today);

        // Calculate expected leaves (accrued from month 1)
        const expectedAccrued = monthsCompleted * 1.5;
        const isEligibleToApply = monthsCompleted >= 6; // Need 6 complete months

        // Get used leaves (approved)
        const { data: usedLeaves, error: usedError } = await supabase
            .from('leaves')
            .select('days_count')
            .eq('employee_id', employeeId)
            .eq('status', 'approved');

        if (usedError) throw usedError;

        const used = usedLeaves?.reduce((sum, leave) => sum + (parseFloat(leave.days_count) || 0), 0) || 0;

        // Get pending leaves
        const { data: pendingLeaves, error: pendingError } = await supabase
            .from('leaves')
            .select('days_count')
            .eq('employee_id', employeeId)
            .eq('status', 'pending');

        if (pendingError) throw pendingError;

        const pending = pendingLeaves?.reduce((sum, leave) => sum + (parseFloat(leave.days_count) || 0), 0) || 0;

        const expectedAvailable = expectedAccrued - used - pending;

        // Get database balance (for current year)
        const currentYear = today.getFullYear();
        const { data: balance, error: balError } = await supabase
            .from('leave_balance')
            .select('*')
            .eq('employee_id', employeeId)
            .eq('leave_year', currentYear)
            .maybeSingle();

        console.log('📋 EMPLOYEE DETAILS:');
        console.log(`   Name: ${emp.first_name} ${emp.last_name}`);
        console.log(`   Employee ID: ${emp.employee_id}`);
        console.log(`   Joining Date: ${emp.joining_date}`);
        console.log(`   Today: ${today.toISOString().split('T')[0]}`);
        console.log(`   Current Year: ${currentYear}`);
        
        console.log('\n📊 CALCULATION (Accrual from Month 1):');
        console.log(`   Total months since joining: ${totalMonths}`);
        console.log(`   Months for accrual calculation: ${monthsForAccrual}`);
        console.log(`   Expected accrued leaves: ${expectedAccrued.toFixed(1)} (${monthsForAccrual} × 1.5)`);
        console.log(`   Used leaves (approved): ${used.toFixed(1)}`);
        console.log(`   Pending leaves: ${pending.toFixed(1)}`);
        console.log(`   Expected available: ${expectedAvailable.toFixed(1)}`);
        console.log(`   Eligible to apply: ${isEligibleToApply ? '✅ YES' : '❌ NO (need 6 months)'}`);
        
        console.log('\n💾 DATABASE RECORD:');
        if (balance) {
            console.log(`   Year: ${balance.leave_year}`);
            console.log(`   Total accrued: ${balance.total_accrued}`);
            console.log(`   Total used: ${balance.total_used}`);
            console.log(`   Total pending: ${balance.total_pending}`);
            console.log(`   Current balance: ${balance.current_balance}`);
            
            // Parse values
            const dbAccrued = parseFloat(balance.total_accrued) || 0;
            const dbUsed = parseFloat(balance.total_used) || 0;
            const dbPending = parseFloat(balance.total_pending) || 0;
            const dbCurrent = parseFloat(balance.current_balance) || 0;
            
            console.log('\n🔎 VERIFICATION:');
            
            // Check accrued
            const accruedMatch = Math.abs(dbAccrued - expectedAccrued) < 0.1;
            console.log(`   Accrued matches: ${accruedMatch ? '✅ ✓' : '❌ ✗'}`);
            if (!accruedMatch) {
                console.log(`      Expected: ${expectedAccrued.toFixed(1)}, DB: ${dbAccrued.toFixed(1)}`);
            }
            
            // Check used
            const usedMatch = Math.abs(dbUsed - used) < 0.1;
            console.log(`   Used matches: ${usedMatch ? '✅ ✓' : '❌ ✗'}`);
            if (!usedMatch) {
                console.log(`      Expected: ${used.toFixed(1)}, DB: ${dbUsed.toFixed(1)}`);
            }
            
            // Check pending
            const pendingMatch = Math.abs(dbPending - pending) < 0.1;
            console.log(`   Pending matches: ${pendingMatch ? '✅ ✓' : '❌ ✗'}`);
            if (!pendingMatch) {
                console.log(`      Expected: ${pending.toFixed(1)}, DB: ${dbPending.toFixed(1)}`);
            }
            
            // Check current balance
            const currentMatch = Math.abs(dbCurrent - expectedAvailable) < 0.1;
            console.log(`   Current balance matches: ${currentMatch ? '✅ ✓' : '❌ ✗'}`);
            if (!currentMatch) {
                console.log(`      Expected: ${expectedAvailable.toFixed(1)}, DB: ${dbCurrent.toFixed(1)}`);
            }
            
            // Summary
            if (accruedMatch && usedMatch && pendingMatch && currentMatch) {
                console.log('\n🎉 ALL CHECKS PASSED! Balance is correct.');
            } else {
                console.log('\n⚠️ SOME CHECKS FAILED! Balance needs correction.');
            }
            
        } else {
            console.log('   ❌ No database record found for current year');
            console.log('\n⚠️ Balance record missing! Run initialization script.');
        }
        
        // Show leave application history
        console.log('\n📅 RECENT LEAVE APPLICATIONS:');
        const { data: recentLeaves, error: leavesError } = await supabase
            .from('leaves')
            .select('id, leave_type, start_date, end_date, days_count, status, applied_date')
            .eq('employee_id', employeeId)
            .order('applied_date', { ascending: false })
            .limit(5);

        if (leavesError) throw leavesError;

        if (recentLeaves && recentLeaves.length > 0) {
            recentLeaves.forEach((leave, index) => {
                console.log(`   ${index + 1}. ${leave.start_date} to ${leave.end_date || leave.start_date} | ${leave.days_count} days | ${leave.status} | ${leave.leave_type}`);
            });
        } else {
            console.log('   No leave applications found');
        }
        
        console.log('\n' + '='.repeat(70) + '\n');

    } catch (error) {
        console.error('❌ Error:', error);
        console.error('Error stack:', error.stack);
    } finally {
        process.exit();
    }
}

// Get employee ID from command line
const employeeId = process.argv[2];
if (!employeeId) {
    console.log('\n⚠️ Please provide employee ID');
    console.log('📝 Usage: node verifyLeaveBalance.js B2B250201');
    console.log('   Example: node verifyLeaveBalance.js B2B260203\n');
    process.exit(1);
}

verifyLeaveBalance(employeeId);

module.exports = { verifyLeaveBalance };