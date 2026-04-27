-- Run in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS announcements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(30) DEFAULT 'announcement' CHECK (type IN ('announcement','notice','warning','holiday','policy','event','urgent')),
    priority VARCHAR(10) DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
    created_by VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT NULL
);

ALTER TABLE announcements DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at DESC);
