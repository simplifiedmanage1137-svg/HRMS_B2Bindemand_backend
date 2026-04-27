// Run: node fix-reporting-manager.js (from backend folder)
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    'https://mbihlgjvyxmmyxytieqv.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1iaWhsZ2p2eXhtbXl4eXRpZXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5NDQ1MDUsImV4cCI6MjA5MDUyMDUwNX0.6ulbym5XYw4wIBgSIcJGSYLbqX7nTo4syfGvxkshSG0'
);

async function fixReportingManagers() {
    // Fix B2B260201: trim leading space
    const { error: e1 } = await supabase
        .from('employees')
        .update({ reporting_manager: 'Shyam Suryavanshi' })
        .eq('employee_id', 'B2B260201');
    console.log('B2B260201 fix:', e1 ? '❌ ' + e1.message : '✅ Updated to "Shyam Suryavanshi"');

    // Fix B2B260402: set full name
    const { error: e2 } = await supabase
        .from('employees')
        .update({ reporting_manager: 'Shyam Suryavanshi' })
        .eq('employee_id', 'B2B260402');
    console.log('B2B260402 fix:', e2 ? '❌ ' + e2.message : '✅ Updated to "Shyam Suryavanshi"');

    // Verify
    const { data } = await supabase
        .from('employees')
        .select('employee_id, reporting_manager')
        .in('employee_id', ['B2B260201', 'B2B260402']);
    console.log('\nVerification:');
    data?.forEach(e => console.log(`  ${e.employee_id}: "${e.reporting_manager}"`));
}

fixReportingManagers().catch(console.error);
