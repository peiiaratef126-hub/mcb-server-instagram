-- ====================================================================
-- MCB Server Instagram - Baseline Database Migration (0001_initial_schema)
-- ====================================================================

-- Enable pgcrypto for UUID generation if needed
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- --------------------------------------------------------------------
-- 1. Encrypted Token Store (Feature 16)
-- Owned solely by core-worker. Token encrypted at rest using AES-GCM.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_tokens (
    account_id VARCHAR(64) PRIMARY KEY,
    token_ciphertext TEXT NOT NULL,
    nonce TEXT NOT NULL,
    key_id VARCHAR(32) NOT NULL DEFAULT 'v1',
    scopes TEXT[] NOT NULL DEFAULT '{}',
    expires_at TIMESTAMPTZ,
    last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --------------------------------------------------------------------
-- 2. Publish Queue & State Machine (Features 4, 5, 6, 15)
-- Concurrency controlled via SELECT ... FOR UPDATE SKIP LOCKED
-- --------------------------------------------------------------------
CREATE TYPE publish_status AS ENUM (
    'pending',
    'scheduled',
    'uploading',
    'processing',
    'published',
    'failed'
);

CREATE TABLE IF NOT EXISTS publish_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(128) NOT NULL,
    account_id VARCHAR(64) NOT NULL,
    media_type VARCHAR(32) NOT NULL, -- IMAGE, VIDEO, REELS, CAROUSEL
    caption TEXT,
    payload JSONB NOT NULL,
    container_id VARCHAR(128),
    published_media_id VARCHAR(128),
    status publish_status NOT NULL DEFAULT 'pending',
    scheduled_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent duplicate publishing of the exact same action/payload
    CONSTRAINT uq_publish_queue_idempotency UNIQUE (account_id, idempotency_key)
);

-- Index for worker poll loop using FOR UPDATE SKIP LOCKED
CREATE INDEX IF NOT EXISTS idx_publish_queue_poll 
ON publish_queue (status, next_run_at) 
WHERE status IN ('pending', 'scheduled', 'uploading', 'processing');

CREATE INDEX IF NOT EXISTS idx_publish_queue_account 
ON publish_queue (account_id, created_at DESC);

-- --------------------------------------------------------------------
-- 3. Atomic Daily Quota Counters (Feature 18)
-- Tracks API call budgets and publishing quotas per account per day.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_quotas (
    account_id VARCHAR(64) NOT NULL,
    quota_date DATE NOT NULL,
    published_posts INT NOT NULL DEFAULT 0,
    api_calls_made INT NOT NULL DEFAULT 0,
    comments_sent INT NOT NULL DEFAULT 0,
    messages_sent INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account_id, quota_date)
);

-- --------------------------------------------------------------------
-- 4. Webhook Events Queue (Features 20, 21)
-- Written by internet-facing gateway, consumed by core-worker.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id VARCHAR(128),
    field VARCHAR(64) NOT NULL, -- comments, messages, mentions, etc.
    payload JSONB NOT NULL,
    signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_unprocessed 
ON webhook_events (created_at ASC) 
WHERE processed = FALSE;

-- --------------------------------------------------------------------
-- 5. Daily Insights Snapshot Store (Feature 28)
-- Window-function capable analytics storage.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS insights_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id VARCHAR(64) NOT NULL,
    snapshot_date DATE NOT NULL,
    metrics JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_insights_account_date UNIQUE (account_id, snapshot_date)
);

-- --------------------------------------------------------------------
-- 6. Audit Logs for Automated Writes (Feature 21)
-- Strict audit trail for every automated action.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id VARCHAR(64) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    target_id VARCHAR(128),
    rule_id VARCHAR(64),
    details JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_account 
ON audit_logs (account_id, created_at DESC);
