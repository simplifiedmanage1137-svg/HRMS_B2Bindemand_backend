-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS office_events (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL DEFAULT 'Office Event',
    description TEXT,
    media_url VARCHAR(500),
    media_type VARCHAR(10) DEFAULT 'image',
    event_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allow broadcast notices: employee_id = 'ALL'
-- If employee_id has a FK constraint, run:
-- ALTER TABLE employee_notices ALTER COLUMN employee_id TYPE TEXT;
-- ALTER TABLE employee_notices DROP CONSTRAINT IF EXISTS employee_notices_employee_id_fkey;
