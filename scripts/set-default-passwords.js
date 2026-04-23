const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');

const setDefaultPasswords = async () => {
    console.log('🔐 Setting default passwords for employees...');

    const { data: employees, error } = await supabase
        .from('employees')
        .select('id, employee_id, email, password, role');

    if (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }

    console.log(`📋 Found ${employees.length} employees\n`);

    let updated = 0, skipped = 0;

    for (const emp of employees) {
        // Skip if already has a hashed password
        if (emp.password && (emp.password.startsWith('$2a$') || emp.password.startsWith('$2b$'))) {
            console.log(`⏭️  ${emp.employee_id} (${emp.email}) - already has password`);
            skipped++;
            continue;
        }

        // Default password = employee_id
        const defaultPassword = emp.employee_id;
        const hashed = await bcrypt.hash(defaultPassword, 10);

        const { error: updateError } = await supabase
            .from('employees')
            .update({ password: hashed })
            .eq('id', emp.id);

        if (updateError) {
            console.error(`❌ Failed ${emp.employee_id}:`, updateError.message);
        } else {
            console.log(`✅ ${emp.employee_id} (${emp.email}) - password set to: ${defaultPassword}`);
            updated++;
        }
    }

    console.log(`\n✅ Done! Updated: ${updated}, Skipped: ${skipped}`);
    console.log('\n📌 Default password for each employee = their Employee ID');
    console.log('   Example: Employee B2B250201 → password: B2B250201');
    process.exit(0);
};

setDefaultPasswords().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
