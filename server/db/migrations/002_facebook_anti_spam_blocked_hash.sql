-- Migration 002: persist the exact content hash that triggered Meta anti-spam blocking.
ALTER TABLE facebook_publisher_state
  ADD COLUMN IF NOT EXISTS blocked_content_hash VARCHAR(64);

-- Allow quarantined publications to be retained for audit without being picked up by the worker.
-- Existing PENDING rows remain untouched.
