# Database Package (`packages/db`)

This package manages the PostgreSQL migrations and schema definitions for MCB Server Instagram (Full Mode).

## Schema Overview

- `access_tokens`: Encrypted storage for long-lived Meta access tokens (AES-GCM at rest, managed strictly by `core-worker`).
- `publish_queue`: Transactional state machine supporting `pending`, `scheduled`, `uploading`, `processing`, `published`, and `failed` states. Picked up by workers using `SELECT ... FOR UPDATE SKIP LOCKED`.
- `daily_quotas`: Atomic per-account, per-day counters preventing Meta API limit exhaustion.
- `webhook_events`: Ingestion table for verified incoming Meta webhooks (`gateway` has `INSERT` only).
- `insights_snapshots`: Historical daily performance records enabling time-series analysis and window functions.
- `audit_logs`: Immutable security audit logs for automated interactions (e.g. deterministic auto-replies).

## Running Migrations

In Docker Compose, migrations in `packages/db/migrations` are automatically executed on initial database container initialization via `/docker-entrypoint-initdb.d`.
