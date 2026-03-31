const bcrypt = require('bcryptjs');

/**
 * Hash a password using bcrypt
 * @param {string} password - Plain text password
 * @param {number} saltRounds - Number of salt rounds (default: 10)
 * @returns {Promise<string>} Hashed password
 */
const hashPassword = async (password, saltRounds = 10) => {
    try {
        const salt = await bcrypt.genSalt(saltRounds);
        const hashedPassword = await bcrypt.hash(password, salt);
        return hashedPassword;
    } catch (error) {
        console.error('Error hashing password:', error);
        throw error;
    }
};

/**
 * Compare a plain text password with a hash
 * @param {string} password - Plain text password to check
 * @param {string} hashedPassword - Stored hash to compare against
 * @returns {Promise<boolean>} True if password matches
 */
const comparePassword = async (password, hashedPassword) => {
    try {
        return await bcrypt.compare(password, hashedPassword);
    } catch (error) {
        console.error('Error comparing passwords:', error);
        return false;
    }
};

/**
 * Generate password hashes for default users
 * Use this to create initial admin/employee accounts
 */
const generateDefaultHashes = async () => {
    try {
        console.log('='.repeat(50));
        console.log('🔐 GENERATING DEFAULT PASSWORD HASHES');
        console.log('='.repeat(50));
        
        const adminHash = await hashPassword('admin123');
        const employeeHash = await hashPassword('Welcome@123');
        
        console.log('\n📋 COPY THESE TO YOUR DATABASE:');
        console.log('-'.repeat(50));
        console.log('Admin password (admin123):');
        console.log(adminHash);
        console.log('-'.repeat(50));
        console.log('Employee password (Welcome@123):');
        console.log(employeeHash);
        console.log('-'.repeat(50));
        
        return {
            admin: adminHash,
            employee: employeeHash,
            employeeDefault: 'Welcome@123'
        };
    } catch (error) {
        console.error('Error generating hashes:', error);
        throw error;
    }
};

/**
 * Generate hash for a specific password
 * @param {string} password - Password to hash
 */
const generateHashForPassword = async (password) => {
    try {
        const hash = await hashPassword(password);
        console.log('\n🔐 Hash for "' + password + '":');
        console.log(hash);
        console.log('\n📝 SQL for Supabase:');
        console.log(`UPDATE users SET password = '${hash}' WHERE ...`);
        return hash;
    } catch (error) {
        console.error('Error:', error);
    }
};

// Run if called directly
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length > 0) {
        // Generate hash for provided password
        generateHashForPassword(args[0]);
    } else {
        // Generate default hashes
        generateDefaultHashes();
    }
}

module.exports = {
    hashPassword,
    comparePassword,
    generateDefaultHashes,
    generateHashForPassword
};