// config/database.js
const mysql = require('mysql2/promise');
require('dotenv').config();

const host = process.env.DB_HOST || 'localhost';
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const database = process.env.DB_NAME || 'ems_db';

const poolConfig = {
    host,
    user,
    password,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let pool = mysql.createPool({ ...poolConfig, database });

// Test the connection and create database if not exists
(async () => {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Database connected successfully');
        console.log('📊 Database:', database);
        
        // Check if tables exist
        const [tables] = await connection.query('SHOW TABLES');
        console.log(`📊 Tables found: ${tables.length}`);
        
        connection.release();
    } catch (error) {
        if (error.code === 'ER_BAD_DB_ERROR') {
            console.log(`⚠️ Database "${database}" not found. Attempting to create it...`);
            try {
                // Create database without selecting it
                const adminPool = mysql.createPool(poolConfig);
                const adminConn = await adminPool.getConnection();
                await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
                console.log(`✅ Database "${database}" created successfully`);
                adminConn.release();
                await adminPool.end();

                // Recreate pool with database
                pool = mysql.createPool({ ...poolConfig, database });
                
                // Test new connection
                const testConn = await pool.getConnection();
                console.log('✅ Connected to new database');
                testConn.release();
            } catch (createError) {
                console.error('❌ Failed to create database:', createError.message);
            }
        } else {
            console.error('❌ Database connection failed:', error.message);
        }
    }
})();

module.exports = pool;