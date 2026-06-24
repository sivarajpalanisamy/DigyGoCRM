-- Add pipeline + stage to Google Sheets configs so imported leads land in the right pipeline
ALTER TABLE google_sheets_configs ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES pipelines(id) ON DELETE SET NULL;
ALTER TABLE google_sheets_configs ADD COLUMN IF NOT EXISTS stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL;
