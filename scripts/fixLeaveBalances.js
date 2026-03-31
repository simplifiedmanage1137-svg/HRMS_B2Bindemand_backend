// scripts/fixLeaveBalances.js - Updated
const supabase = require('../config/supabase');

async function fixLeaveBalances() {
    console.log('='.repeat(70));
    console.log('🔄 FIXING LEAVE BALANCES - RESETTING ALL');
    console.log('='.repeat(70));
    
    try {
        // Delete all existing leave_balance records
        const { error: deleteError } = await supabase
            .from('leave_balance')
            .delete()
            .neq('employee_id', '');
            
        if (deleteError) {
            console.log('Could not delete existing records:', deleteError.message);
        } else {
            console.log('✅ Deleted existing leave_balance records');
        }
        
        // Delete all leave_transactions
        const { error: deleteTransError } = await supabase
            .from('leave_transactions')
            .delete()
            .neq('id', 0);
            
        if (deleteTransError) {
            console.log('Could not delete transactions:', deleteTransError.message);
        } else {
            console.log('✅ Deleted existing leave_transactions');
        }
        
        // Get all employees
        const { data: employees, error: empError } = await supabase
            .from('employees')
            .select('employee_id, joining_date, first_name, last_name');
            
        if (empError) throw empError;
        
        const results = {
            total: employees?.length || 0,
            updated: 0,
            errors: []
        };
        
        for (const emp of employees || []) {
            try {
                const joiningDate = new Date(emp.joining_date);
                const today = new Date();
                const currentYear = today.getFullYear();
                
                // Calculate months completed
                let monthsCompleted = (today.getFullYear() - joiningDate.getFullYear()) * 12;
                monthsCompleted += (today.getMonth() - joiningDate.getMonth());
                
                if (today.getDate() < joiningDate.getDate()) {
                    monthsCompleted -= 1;
                }
                monthsCompleted = Math.max(0, monthsCompleted);
                
                // Calculate total accrued (only after probation)
                let totalAccrued = 0;
                if (monthsCompleted >= 6) {
                    const monthsAfterProbation = monthsCompleted - 6;
                    totalAccrued = monthsAfterProbation * 1.5;
                }
                
                // Get used leaves
                const { data: usedLeaves } = await supabase
                    .from('leaves')
                    .select('days_count')
                    .eq('employee_id', emp.employee_id)
                    .eq('status', 'approved')
                    .in('leave_type', ['Annual', 'Sick', 'Personal', 'Maternity', 'Paternity', 'Bereavement'])
                    .gte('start_date', `${currentYear}-01-01`)
                    .lte('start_date', `${currentYear}-12-31`);
                
                const used = usedLeaves?.reduce((sum, l) => sum + (l.days_count || 0), 0) || 0;
                
                // Get pending leaves
                const { data: pendingLeaves } = await supabase
                    .from('leaves')
                    .select('days_count')
                    .eq('employee_id', emp.employee_id)
                    .eq('status', 'pending')
                    .in('leave_type', ['Annual', 'Sick', 'Personal', 'Maternity', 'Paternity', 'Bereavement'])
                    .gte('start_date', `${currentYear}-01-01`)
                    .lte('start_date', `${currentYear}-12-31`);
                
                const pending = pendingLeaves?.reduce((sum, l) => sum + (l.days_count || 0), 0) || 0;
                const available = Math.max(0, totalAccrued - used - pending);
                
                // Insert new balance
                const { error: insertError } = await supabase
                    .from('leave_balance')
                    .insert([{
                        employee_id: emp.employee_id,
                        leave_year: currentYear,
                        total_accrued: totalAccrued,
                        total_used: used,
                        total_pending: pending,
                        current_balance: available,
                        last_updated: today.toISOString()
                    }]);
                
                if (insertError) throw insertError;
                
                results.updated++;
                console.log(`✅ ${emp.employee_id}: ${emp.first_name} ${emp.last_name} -> Accrued: ${totalAccrued}, Used: ${used}, Available: ${available}`);
                
            } catch (empError) {
                results.errors.push({
                    employee_id: emp.employee_id,
                    error: empError.message
                });
                console.error(`❌ Failed for ${emp.employee_id}:`, empError.message);
            }
        }
        
        console.log('='.repeat(70));
        console.log('📊 FIX SUMMARY');
        console.log(`Total employees: ${results.total}`);
        console.log(`Updated: ${results.updated}`);
        console.log(`Errors: ${results.errors.length}`);
        console.log('='.repeat(70));
        
        return results;
        
    } catch (error) {
        console.error('❌ Fix failed:', error);
        throw error;
    }
}

// Run the fix
fixLeaveBalances()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });