// scripts/scheduleMonthlyAccrual.js - UPDATED

const cron = require('node-cron');
const supabase = require('../config/supabase');
const LeaveYearlyService = require('../services/leaveYearlyService');

// Schedule to run at 11:00 PM on the last day of every month
cron.schedule('0 23 28-31 * *', async () => {
    // Check if today is actually the last day of the month
    const today = new Date();
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    
    if (today.getDate() !== lastDay) {
        console.log(`📅 Not last day of month (${today.getDate()}/${lastDay}), skipping...`);
        return;
    }
    
    console.log('='.repeat(70));
    console.log('🔄 STARTING MONTHLY LEAVE ACCRUAL PROCESS');
    console.log(`📅 Date: ${today.toISOString().split('T')[0]} (Last day of month)`);
    console.log(`📅 Accruing for month: ${today.toLocaleString('default', { month: 'long' })} ${today.getFullYear()}`);
    console.log('='.repeat(70));
    
    try {
        // Get all active employees
        const { data: employees, error: empError } = await supabase
            .from('employees')
            .select('employee_id, joining_date, employee_status')
            .eq('employee_status', 'Active');

        if (empError) throw empError;

        console.log(`📊 Found ${employees?.length || 0} active employees`);
        
        const results = {
            total: employees?.length || 0,
            success: 0,
            failed: 0,
            details: []
        };
        
        for (const emp of employees || []) {
            console.log(`\n📋 Processing employee: ${emp.employee_id}`);
            console.log(`   Joining date: ${emp.joining_date}`);
            
            const result = await LeaveYearlyService.addMonthlyAccrual(emp.employee_id);
            
            if (result.success) {
                results.success++;
                results.details.push({
                    employee_id: emp.employee_id,
                    success: true,
                    message: result.message,
                    pending_months: result.pending_months
                });
                console.log(`   ✅ ${result.message}`);
            } else {
                results.failed++;
                results.details.push({
                    employee_id: emp.employee_id,
                    success: false,
                    message: result.message
                });
                console.log(`   ⚠️ ${result.message}`);
            }
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log('\n' + '='.repeat(70));
        console.log('📊 ACCRUAL PROCESS SUMMARY:');
        console.log(`   Month: ${today.toLocaleString('default', { month: 'long' })} ${today.getFullYear()}`);
        console.log(`   Total employees: ${results.total}`);
        console.log(`   Successful: ${results.success}`);
        console.log(`   No accrual needed: ${results.failed}`);
        console.log('='.repeat(70));
        
        // Log results to database
        try {
            await supabase
                .from('system_logs')
                .insert([{
                    log_type: 'monthly_accrual',
                    executed_at: new Date().toISOString(),
                    month: today.getMonth() + 1,
                    year: today.getFullYear(),
                    summary: results,
                    status: results.failed === results.total ? 'failed' : 'partial'
                }]);
        } catch (logError) {
            console.log('⚠️ Could not log to system_logs table');
        }
            
    } catch (error) {
        console.error('❌ Error in monthly accrual process:', error);
        
        try {
            await supabase
                .from('system_logs')
                .insert([{
                    log_type: 'monthly_accrual',
                    executed_at: new Date().toISOString(),
                    summary: { error: error.message },
                    status: 'failed'
                }]);
        } catch (logError) {
            console.log('⚠️ Could not log error to system_logs table');
        }
    }
    
    console.log('='.repeat(70));
    console.log('✅ MONTHLY ACCRUAL PROCESS COMPLETED');
    console.log('='.repeat(70));
});

console.log('📅 Monthly accrual scheduler started - will run at 11 PM on last day of each month');