-- Run this in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS employee_notices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id VARCHAR(50) NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(20) DEFAULT 'notice' CHECK (type IN ('notice', 'warning')),
    sent_by_id VARCHAR(50) NOT NULL,
    sent_by_role VARCHAR(20) NOT NULL,
    sender_name VARCHAR(100),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_notices_employee_id ON employee_notices(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_notices_sent_by_id ON employee_notices(sent_by_id);
