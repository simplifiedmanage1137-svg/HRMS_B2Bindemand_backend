const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials. Please check your .env file');
    console.error('SUPABASE_URL:', supabaseUrl ? '✓ Present' : '✗ Missing');
    console.error('SUPABASE_ANON_KEY:', supabaseKey ? '✓ Present' : '✗ Missing');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('✅ Supabase client initialized');

module.exports = supabase;