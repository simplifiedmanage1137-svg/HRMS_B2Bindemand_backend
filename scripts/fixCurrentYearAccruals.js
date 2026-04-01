// scripts/fixCurrentYearAccruals.js - FIXED VERSION

const supabase = require('../config/supabase');
const LeaveYearlyService = require('../services/leaveYearlyService');

async function fixCurrentYearAccruals() {
    console.log('\n' + '='.repeat(70));
    console.log('🔧 FIXING ACCRUALS FOR CURRENT YEAR EMPLOYEES');
    console.log('='.repeat(70));
    
    try {
        const currentYear = new Date().getFullYear();
        const startOfYear = `${currentYear}-01-01`;
        
        // Get all active employees who joined this year
        // Using employee_status instead of status
        const { data: employees, error: empError } = await supabase
            .from('employees')
            .select('employee_id, joining_date, first_name, last_name, employee_status')
            .eq('employee_status', 'Active')
            .gte('joining_date', startOfYear);
            
        if (empError) {
            console.error('❌ Error fetching employees:', empError);
            throw empError;
        }
        
        console.log(`📊 Found ${employees?.length || 0} employees who joined in ${currentYear}`);
        
        if (!employees || employees.length === 0) {
            console.log('No current year employees found');
            return;
        }
        
        console.log('\n📋 Employees to process:');
        employees.forEach(emp => {
            console.log(`   - ${emp.employee_id}: ${emp.first_name} ${emp.last_name} (Joined: ${emp.joining_date})`);
        });
        
        const results = {
            total: employees.length,
            success: 0,
            failed: 0,
            details: []
        };
        
        for (const emp of employees) {
            console.log(`\n🔍 Processing: ${emp.employee_id} (${emp.first_name} ${emp.last_name})`);
            console.log(`   Joining Date: ${emp.joining_date}`);
            
            // Run accrual to fix missing ones
            const result = await LeaveYearlyService.addMonthlyAccrual(emp.employee_id);
            
            if (result.success) {
                results.success++;
                results.details.push({
                    employee_id: emp.employee_id,
                    name: `${emp.first_name} ${emp.last_name}`,
                    status: 'success',
                    message: result.message,
                    pending_months: result.pending_months
                });
                console.log(`   ✅ ${result.message}`);
            } else {
                results.failed++;
                results.details.push({
                    employee_id: emp.employee_id,
                    name: `${emp.first_name} ${emp.last_name}`,
                    status: 'failed',
                    message: result.message
                });
                console.log(`   ⚠️ ${result.message}`);
            }
        }
        
        console.log('\n' + '='.repeat(70));
        console.log('📊 FIX SUMMARY:');
        console.log(`   Total current year employees: ${results.total}`);
        console.log(`   Successfully fixed: ${results.success}`);
        console.log(`   Failed/Skipped: ${results.failed}`);
        console.log('='.repeat(70));
        
        // Show detailed results
        if (results.details.length > 0) {
            console.log('\n📝 DETAILS:');
            results.details.forEach(detail => {
                if (detail.status === 'success') {
                    console.log(`   ✅ ${detail.name} (${detail.employee_id}): ${detail.message}`);
                    if (detail.pending_months && detail.pending_months.length > 0) {
                        console.log(`      Added for: ${detail.pending_months.join(', ')}`);
                    }
                } else {
                    console.log(`   ⚠️ ${detail.name} (${detail.employee_id}): ${detail.message}`);
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Error fixing accruals:', error);
    }
}

// Run the fix
fixCurrentYearAccruals()
    .then(() => {
        console.log('\n✅ Fix completed!');
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Fix failed:', err);
        process.exit(1);
    });