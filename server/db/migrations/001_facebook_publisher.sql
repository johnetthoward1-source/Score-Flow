-- Migration 001: Centralized Facebook Publisher State, Pending Queue, and Distributed Lock
-- Safe, backward-compatible migration without dropping any existing tables or data

CREATE TABLE IF NOT EXISTS facebook_publisher_state (
    id VARCHAR(32) PRIMARY KEY DEFAULT 'default',
    publishing_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    publishing_paused BOOLEAN NOT NULL DEFAULT FALSE,
    pause_reason TEXT,
    cooldown_until TIMESTAMP WITH TIME ZONE,
    cooldown_reason TEXT,
    last_attempt_at TIMESTAMP WITH TIME ZONE,
    last_publish_at TIMESTAMP WITH TIME ZONE,
    last_successful_publish_at TIMESTAMP WITH TIME ZONE,
    last_facebook_post_id VARCHAR(128),
    last_published_content_hash VARCHAR(64),
    pending_content_hash VARCHAR(64),
    consecutive_meta_blocks INT NOT NULL DEFAULT 0,
    total_meta_blocks INT NOT NULL DEFAULT 0,
    last_error_code INT,
    last_error_message TEXT,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Seed default singleton state row if not present
INSERT INTO facebook_publisher_state (id, publishing_enabled, publishing_paused, updated_at)
VALUES ('default', TRUE, FALSE, NOW())
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS facebook_pending_publication (
    id VARCHAR(64) PRIMARY KEY,
    publication_type VARCHAR(32) NOT NULL, -- 'LIVE' | 'FULL_TIME' | 'MANUAL' | 'TEST'
    content TEXT NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'SKIPPED'
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    attempt_count INT NOT NULL DEFAULT 0,
    last_error TEXT,
    available_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS facebook_publisher_lock (
    lock_name VARCHAR(64) PRIMARY KEY,
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    lock_owner VARCHAR(128),
    locked_at TIMESTAMP WITH TIME ZONE,
    lease_until TIMESTAMP WITH TIME ZONE
);

-- Seed singleton lock record
INSERT INTO facebook_publisher_lock (lock_name, locked)
VALUES ('fb_publish_master_lock', FALSE)
ON CONFLICT (lock_name) DO NOTHING;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_fb_pending_status ON facebook_pending_publication(status);
CREATE INDEX IF NOT EXISTS idx_fb_pending_type ON facebook_pending_publication(publication_type);
CREATE INDEX IF NOT EXISTS idx_fb_pending_available ON facebook_pending_publication(available_at);
