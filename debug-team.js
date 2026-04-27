// Run: node debug-team.js (from backend folder)
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    'https://mbihlgjvyxmmyxytieqv.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1iaWhsZ2p2eXhtbXl4eXRpZXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5NDQ1MDUsImV4cCI6MjA5MDUyMDUwNX0.6ulbym5XYw4wIBgSIcJGSYLbqX7nTo4syfGvxkshSG0'
);

async function debugTeam() {
    console.log('\n=== MANAGER (B2B250201) ===');
    const { data: manager } = await supabase
        .from('employees')
        .select('employee_id, first_name, last_name, designation')
        .eq('employee_id', 'B2B250201')
        .single();
    console.log(manager);
    const managerName = manager ? `${manager.first_name} ${manager.last_name}` : '';
    console.log('Manager full name:', JSON.stringify(managerName));

    console.log('\n=== EMPLOYEES (B2B260201, B2B260402) ===');
    const { data: emps } = await supabase
        .from('employees')
        .select('employee_id, first_name, last_name, reporting_manager')
        .in('employee_id', ['B2B260201', 'B2B260402']);
    emps?.forEach(e => {
        console.log(`${e.employee_id}: reporting_manager = ${JSON.stringify(e.reporting_manager)}`);
        console.log(`  Match: ${e.reporting_manager === managerName} | ilike would match: ${e.reporting_manager?.toLowerCase().trim() === managerName.toLowerCase().trim()}`);
    });
}

debugTeam().catch(console.error);
