const supabase = require('../config/supabase');

async function migrateAttendance() {
    console.log('='.repeat(70));
    console.log('🔄 ATTENDANCE MIGRATION STARTED');
    console.log('='.repeat(70));
    
    try {
        // Check if employees table exists (prerequisite)
        const { data: empTables, error: empCheckError } = await supabase
            .from('information_schema.tables')
            .select('table_name')
            .eq('table_name', 'employees')
            .eq('table_schema', 'public');

        if (empCheckError) throw empCheckError;

        if (!empTables || empTables.length === 0) {
            console.error('❌ Employees table does not exist. Please run employee migration first.');
            process.exit(1);
        }

        // Check if attendance table exists
        const { data: attTables, error: attCheckError } = await supabase
            .from('information_schema.tables')
            .select('table_name')
            .eq('table_name', 'attendance')
            .eq('table_schema', 'public');

        if (attCheckError) throw attCheckError;

        if (!attTables || attTables.length === 0) {
            console.log('📋 Creating attendance table...');
            
            // Create attendance table
            const { error: createError } = await supabase.rpc('create_attendance_table');
            
            // If RPC doesn't exist, create table manually
            if (createError && createError.message.includes('function does not exist')) {
                console.log('Creating table via SQL...');
                await createAttendanceTableManually();
            } else if (createError) {
                throw createError;
            } else {
                console.log('✅ Attendance table created via RPC');
            }
        } else {
            console.log('✅ Attendance table exists, checking columns...');
            
            // Get existing columns
            const { data: columns, error: colError } = await supabase
                .from('information_schema.columns')
                .select('column_name, data_type')
                .eq('table_name', 'attendance')
                .eq('table_schema', 'public');

            if (colError) throw colError;

            const columnNames = columns.map(col => col.column_name);
            console.log('📊 Existing columns:', columnNames);

            // Check and add missing columns
            const requiredColumns = [
                { name: 'early_minutes', type: 'DECIMAL(8,3)', default: '0' },
                { name: 'shift_time_used', type: 'VARCHAR(50)', default: 'NULL' },
                { name: 'location_accuracy', type: 'DECIMAL(5,2)', default: 'NULL' },
                { name: 'geofence_status', type: 'VARCHAR(10)', default: 'NULL' },
                { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' }
            ];

            for (const col of requiredColumns) {
                if (!columnNames.includes(col.name)) {
                    console.log(`➕ Adding column: ${col.name}...`);
                    await addColumnToAttendance(col.name, col.type, col.default);
                } else {
                    console.log(`✅ Column ${col.name} exists`);
                }
            }
        }

        // Check if attendance_sessions table exists
        const { data: sessTables, error: sessCheckError } = await supabase
            .from('information_schema.tables')
            .select('table_name')
            .eq('table_name', 'attendance_sessions')
            .eq('table_schema', 'public');

        if (sessCheckError) throw sessCheckError;

        if (!sessTables || sessTables.length === 0) {
            console.log('📋 Creating attendance_sessions table...');
            
            const { error: createError } = await supabase.rpc('create_attendance_sessions_table');
            
            if (createError && createError.message.includes('function does not exist')) {
                await createSessionsTableManually();
            } else if (createError) {
                throw createError;
            } else {
                console.log('✅ attendance_sessions table created via RPC');
            }
        } else {
            console.log('✅ attendance_sessions table exists');
            
            // Get existing columns
            const { data: sessColumns, error: sessColError } = await supabase
                .from('information_schema.columns')
                .select('column_name')
                .eq('table_name', 'attendance_sessions')
                .eq('table_schema', 'public');

            if (sessColError) throw sessColError;

            const sessColumnNames = sessColumns.map(col => col.column_name);
            
            // Check for location columns
            const requiredSessColumns = [
                { name: 'latitude', type: 'DECIMAL(10,8)', default: 'NULL' },
                { name: 'longitude', type: 'DECIMAL(11,8)', default: 'NULL' },
                { name: 'location_accuracy', type: 'DECIMAL(5,2)', default: 'NULL' }
            ];

            for (const col of requiredSessColumns) {
                if (!sessColumnNames.includes(col.name)) {
                    console.log(`➕ Adding column to sessions: ${col.name}...`);
                    await addColumnToSessions(col.name, col.type, col.default);
                }
            }
        }

        console.log('='.repeat(70));
        console.log('✅ ATTENDANCE MIGRATION COMPLETED SUCCESSFULLY!');
        console.log('='.repeat(70));

    } catch (error) {
        console.error('❌ Migration failed:', error);
        console.error('Error stack:', error.stack);
        process.exit(1);
    }
}

// Helper function to create attendance table manually
async function createAttendanceTableManually() {
    const { error } = await supabase.query(`
        CREATE TABLE IF NOT EXISTS attendance (
            id SERIAL PRIMARY KEY,
            employee_id VARCHAR(20) NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
            attendance_date DATE NOT NULL,
            clock_in TIMESTAMP WITH TIME ZONE,
            clock_out TIMESTAMP WITH TIME ZONE,
            total_hours DECIMAL(5,2) DEFAULT 0,
            status VARCHAR(20) DEFAULT 'absent' CHECK (status IN ('present', 'half_day', 'absent', 'holiday')),
            late_minutes DECIMAL(8,3) DEFAULT 0,
            early_minutes DECIMAL(8,3) DEFAULT 0,
            latitude DECIMAL(10,8),
            longitude DECIMAL(11,8),
            location_accuracy DECIMAL(5,2),
            geofence_status VARCHAR(10) CHECK (geofence_status IN ('inside', 'outside')),
            shift_time_used VARCHAR(50),
            session_id VARCHAR(100),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(employee_id, attendance_date)
        );

        CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, attendance_date);
        CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);
        CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id);
    `);

    if (error) throw error;
    console.log('✅ Attendance table created manually');
}

// Helper function to create sessions table manually
async function createSessionsTableManually() {
    const { error } = await supabase.query(`
        CREATE TABLE IF NOT EXISTS attendance_sessions (
            id SERIAL PRIMARY KEY,
            employee_id VARCHAR(20) NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
            session_id VARCHAR(100) NOT NULL,
            clock_in_time TIMESTAMP WITH TIME ZONE NOT NULL,
            last_heartbeat TIMESTAMP WITH TIME ZONE NOT NULL,
            clock_out_time TIMESTAMP WITH TIME ZONE,
            latitude DECIMAL(10,8),
            longitude DECIMAL(11,8),
            location_accuracy DECIMAL(5,2),
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_employee ON attendance_sessions(employee_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_session ON attendance_sessions(session_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_active ON attendance_sessions(is_active);
    `);

    if (error) throw error;
    console.log('✅ attendance_sessions table created manually');
}

// Helper function to add column to attendance table
async function addColumnToAttendance(columnName, columnType, defaultValue) {
    const { error } = await supabase.query(`
        ALTER TABLE attendance 
        ADD COLUMN IF NOT EXISTS ${columnName} ${columnType} DEFAULT ${defaultValue}
    `);

    if (error) {
        console.error(`❌ Failed to add column ${columnName}:`, error);
    } else {
        console.log(`✅ Column ${columnName} added`);
    }
}

// Helper function to add column to sessions table
async function addColumnToSessions(columnName, columnType, defaultValue) {
    const { error } = await supabase.query(`
        ALTER TABLE attendance_sessions 
        ADD COLUMN IF NOT EXISTS ${columnName} ${columnType} DEFAULT ${defaultValue}
    `);

    if (error) {
        console.error(`❌ Failed to add column ${columnName}:`, error);
    } else {
        console.log(`✅ Column ${columnName} added to sessions`);
    }
}

// Run the migration
migrateAttendance();

module.exports = { migrateAttendance };