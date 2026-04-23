const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');

const hashPasswords = async () => {
    console.log('🔐 Starting password hashing for existing users...');

    const { data: users, error } = await supabase
        .from('users')
        .select('id, email, password');

    if (error) {
        console.error('❌ Error fetching users:', error);
        process.exit(1);
    }

    console.log(`📋 Found ${users.length} users`);

    let updated = 0, skipped = 0;

    for (const user of users) {
        // Skip if already bcrypt hashed (starts with $2a$ or $2b$)
        if (user.password && (user.password.startsWith('$2a$') || user.password.startsWith('$2b$'))) {
            console.log(`⏭️  ${user.email} - already hashed, skipping`);
            skipped++;
            continue;
        }

        if (!user.password) {
            console.log(`⚠️  ${user.email} - no password, skipping`);
            skipped++;
            continue;
        }

        // Hash the plain text password
        const hashed = await bcrypt.hash(user.password, 10);
        const { error: updateError } = await supabase
            .from('users')
            .update({ password: hashed })
            .eq('id', user.id);

        if (updateError) {
            console.error(`❌ Failed to update ${user.email}:`, updateError.message);
        } else {
            console.log(`✅ ${user.email} - password hashed`);
            updated++;
        }
    }

    console.log(`\n✅ Done! Updated: ${updated}, Skipped: ${skipped}`);
    process.exit(0);
};

hashPasswords().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
