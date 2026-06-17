-- Migration 103: Add assigned_staff JSONB array to wa_personal_sessions
-- Stores array of user IDs that are allowed to send from this device

ALTER TABLE wa_personal_sessions ADD COLUMN IF NOT EXISTS assigned_staff JSONB DEFAULT '[]'::jsonb;
