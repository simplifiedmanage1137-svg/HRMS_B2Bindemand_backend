const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://mbihlgjvyxmmyxytieqv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1iaWhsZ2p2eXhtbXl4eXRpZXF2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDk0NDUwNSwiZXhwIjoyMDkwNTIwNTA1fQ.iUvXCXpgrvnnGeBl6GoTJk5z_0fCF3h7K9YKm-g4bHE'
);

async function main() {
  const { data, error } = await supabase
    .from('attendance')
    .select('id, attendance_date, clock_in, clock_out, total_minutes, status, late_minutes')
    .eq('employee_id', 'B2B260412')
    .gte('attendance_date', '2025-05-18')
    .lte('attendance_date', '2025-05-20')
    .order('attendance_date');

  console.log('Records:', JSON.stringify(data, null, 2));
  console.log('Error:', error);
}
main();
