-- Dual-SIM enforcement: record how many physical SIMs a device has, so the call
-- ingest gate can fail CLOSED on a multi-SIM device that sends a call with no SIM
-- attribution (it cannot be proven to come from the CRM-verified SIM).
-- Backfilled from sim_info (the SIM list captured at registration).
ALTER TABLE mobile_devices ADD COLUMN IF NOT EXISTS sim_count INTEGER;

UPDATE mobile_devices
SET sim_count = jsonb_array_length(sim_info)
WHERE sim_count IS NULL
  AND jsonb_typeof(sim_info) = 'array';
