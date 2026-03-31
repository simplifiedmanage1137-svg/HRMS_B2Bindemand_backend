// cron/monthlyLeaveAccrual.js
const cron = require('node-cron');
const LeaveYearlyService = require('../services/leaveYearlyService');
const supabase = require('../config/supabase');

// Run every minute to check if it's time to accrue
cron.schedule('* * * * *', async () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDate = now.getDate();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const isLastDay = currentDate === lastDayOfMonth;
    const isAfter1159PM = (currentHour === 23 && currentMinute >= 59) || (currentHour >= 0 && currentDate > lastDayOfMonth);
    
    // Only run on last day of month at/after 11:59 PM, or on 1st of next month
    if (!isLastDay && !(currentDate === 1 && isAfter1159PM)) {
        return;
    }
    
    console.log('='.repeat(70));
    console.log('🔄 RUNNING MONTHLY LEAVE ACCRUAL JOB');
    console.log('Date:', now.toLocaleString());
    console.log('Time:', now.toLocaleTimeString());
    console.log('Month:', new Date(currentYear, currentMonth, 1).toLocaleString('default', { month: 'long' }));
    console.log('='.repeat(70));
    
    try {
        // Get all active employees
        const { data: employees, error: empError } = await supabase
            .from('employees')
            .select('employee_id, joining_date, first_name, last_name')
            .eq('is_active', true);

        if (empError) throw empError;

        const results = {
            total: employees?.length || 0,
            successful: 0,
            failed: 0,
            skipped: 0,
            details: []
        };

        for (const emp of employees || []) {
            try {
                const result = await LeaveYearlyService.addMonthlyAccrual(emp.employee_id);
                
                if (result.success) {
                    results.successful++;
                    results.details.push({
                        employee_id: emp.employee_id,
                        name: `${emp.first_name} ${emp.last_name}`,
                        status: 'success',
                        message: result.message
                    });
                    console.log(`✅ ${emp.employee_id}: ${result.message}`);
                } else if (result.message.includes('Already accrued')) {
                    results.skipped++;
                    results.details.push({
                        employee_id: emp.employee_id,
                        name: `${emp.first_name} ${emp.last_name}`,
                        status: 'skipped',
                        message: result.message
                    });
                } else {
                    results.failed++;
                    results.details.push({
                        employee_id: emp.employee_id,
                        name: `${emp.first_name} ${emp.last_name}`,
                        status: 'failed',
                        message: result.message
                    });
                    console.log(`⚠️ ${emp.employee_id}: ${result.message}`);
                }
                
            } catch (empError) {
                results.failed++;
                results.details.push({
                    employee_id: emp.employee_id,
                    name: `${emp.first_name} ${emp.last_name}`,
                    status: 'failed',
                    error: empError.message
                });
                console.error(`❌ Error for ${emp.employee_id}:`, empError.message);
            }
        }

        console.log('='.repeat(70));
        console.log('📊 MONTHLY ACCRUAL SUMMARY');
        console.log(`Month: ${new Date(currentYear, currentMonth, 1).toLocaleString('default', { month: 'long' })} ${currentYear}`);
        console.log(`Total employees: ${results.total}`);
        console.log(`Successful: ${results.successful}`);
        console.log(`Skipped: ${results.skipped}`);
        console.log(`Failed: ${results.failed}`);
        console.log('='.repeat(70));
        
    } catch (error) {
        console.error('❌ Monthly accrual job failed:', error);
    }
    
    console.log('='.repeat(70) + '\n');
});

console.log('✅ Monthly leave accrual cron job configured (runs at 11:59 PM on last day of month)');