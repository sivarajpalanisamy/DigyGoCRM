-- Add error_reason to messages for failed WABA delivery tracking
ALTER TABLE messages ADD COLUMN IF NOT EXISTS error_reason TEXT;

-- Add meta_template_id to templates for tracking submitted templates
ALTER TABLE templates ADD COLUMN IF NOT EXISTS meta_template_id VARCHAR(100);
