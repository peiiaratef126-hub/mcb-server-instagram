# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-09-28

### Added
- **Edge Webhook Gateway Service (`services/gateway`)**:
  - Zero-token architecture: Internet-facing service operates without Instagram Access Tokens in its environment or memory.
  - Implements Meta `hub.challenge` verification handshake (`GET /webhook`).
  - Strict HMAC-SHA256 signature verification (`POST /webhook`) using `crypto/subtle.ConstantTimeCompare` against `META_APP_SECRET`.
  - Body size limitation enforcing max 256KB with HTTP 413 Payload Too Large rejections.
  - Persists verified incoming events into `webhook_events` PostgreSQL queue table.
- **Asynchronous Webhook Event Dispatcher (`services/core-worker`)**:
  - Polling worker loop claiming unprocessed webhook events with atomic state transitions.
  - Parses and dispatches Instagram comment changes, mentions, and incoming direct messages.
- **Engagement & Realtime MCP Tools (TypeScript / Lite & Full Modes)**:
  - `get_user_tags` (Feature 12): Inspect media items where the account was tagged by external users.
  - `get_mentions` (Feature 12): Inspect comments and media where the account was mentioned.
  - `list_conversations` (Feature 14): List direct message conversation threads.
  - `get_conversation_messages` (Feature 14): Retrieve message history within a conversation thread.
  - `preview_send_dm` & `execute_send_dm` (Feature 14): Two-step confirmation flow with single-use cryptographic tokens to dispatch Instagram Direct Messages.
- **Deterministic Auto-Reply Rules Engine (Feature 21)**:
  - Strict security: Disabled by default (`AUTO_REPLY_ENABLED=false`).
  - Rule-based only: Deterministic keyword matching and regular expressions without LLM invocation.
  - Per-rule, per-user sliding window rate capping (default: max 5 replies/hour per user).
  - Immutable execution audit logs recorded in `audit_logs` table for every automated write.
- **Webhook Architecture & Tunneling Guide**:
  - Comprehensive documentation in `docs/webhooks.md` covering Cloudflare Tunnels, ngrok, reverse proxy setup, and Meta webhook subscriptions.

### Security
- External user-generated content from comments, mentions, tags, and direct messages is quarantined as untrusted data with explicit warnings.
- Auto-replies are strictly opt-in and rate-capped to eliminate spam and infinite reply loops.
- Forged webhook signatures and oversized requests are rejected at the edge before any database interaction.

## [0.2.0] - 2026-09-28

### Added
- **Publishing & Scheduling Tools (TypeScript / Lite & Full Modes)**:
  - `preview_publish_image` & `execute_publish_image` (Feature 4): Single-image publishing to feed with aspect-ratio validation (4:5 to 1.91:1) and two-step confirmation.
  - `preview_publish_video` & `execute_publish_video` (Feature 5): Reels and video feed publishing via Graph API resumable containers.
  - `preview_publish_carousel` & `execute_publish_carousel` (Feature 6): Multi-item album publishing (2–10 images or videos) with child container state reconciliation.
  - `preview_schedule_post` & `execute_schedule_post` (Feature 15): Post scheduling with strict Meta time window enforcement (20 minutes to 75 days in advance) or local worker queue deferral.
- **Media Validation & Transcoding Service (Python / FFmpeg)**:
  - `ImageValidator`: Strict validation for JPEG/PNG, max dimensions (1920x1080), file sizes (<=8MB), and aspect ratio bounds.
  - `VideoValidator`: FFprobe-based validation checking H.264/AAC, framerate (23-60fps), bitrate (<=25Mbps), duration (3s to 15m for feed, 3s to 90s for reels), and 9:16 vertical requirement for Reels.
  - `transcode_to_reels`: Automatic FFmpeg transcoding converting arbitrary videos to Instagram Reels spec (1080x1920, 30fps, H.264 high profile, AAC audio).
  - `convert_image_to_jpeg`: Pillow-based image optimization and JPEG format standardization.
- **Publishing State Machine & Exactly-Once Lifecycle (Go / Worker)**:
  - `PublishEngine`: Graph API publishing coordinator managing the full async lifecycle: container initialization -> exponential backoff status polling (`IN_PROGRESS` -> `FINISHED`) -> final container publishing.
  - Handles single image containers, resumable video containers, and composite multi-item carousels.
  - Zero double-posting guarantee: Atomic `SELECT ... FOR UPDATE SKIP LOCKED` combined with state machine checks prevents duplicate container creation or publish calls across concurrent workers.
- **Media Upload Specifications**:
  - Comprehensive documentation in `docs/media-upload.md` detailing Meta Graph API v21.0 requirements, resumable chunked video uploads, and image hosting strategies.

### Security
- All publishing operations require mandatory two-step confirmation (`preview_*` -> `execute_*`) with SHA-256 payload integrity hashing.
- Video upload URLs and container IDs are handled securely without logging access tokens.

## [0.1.0] - 2026-09-28

### Added
- **MCP Server (Lite Mode)**: Fully functional TypeScript MCP server running over stdio, requiring no Docker.
- **Provider Abstraction Layer**:
  - `FacebookLoginProvider` targeting Meta Graph API v21.0 (`https://graph.facebook.com/v21.0`).
  - `MockInstagramGraphProvider` with deterministic offline fixtures modeled on official Meta documentation.
- **Read-Only Tools**:
  - `get_profile_info` (Feature 1): Fetches account profile details, biography, followers, follows, and media count.
  - `get_recent_posts` (Feature 2): Fetches published media with cursor pagination.
  - `get_post_details` (Feature 3): Deep query of post metadata, media assets, and carousel album children.
  - `list_comments` (Feature 7): Fetches comment threads with untrusted data isolation warnings.
  - `get_account_insights` (Feature 10): Fetches account reach, impressions, profile views, and interaction metrics.
  - `get_post_insights` (Feature 11): Fetches media-level reach, saves, and interaction insights.
- **Two-Step Confirmation Engine & Write Tools**:
  - `ConfirmationStore`: Ephemeral in-memory confirmation token generator with 5-minute TTL and single-use burn-after-reading semantics.
  - `preview_reply_comment` & `execute_reply_comment` (Feature 8): Two-step flow for replying to Instagram comments.
  - `preview_modify_comment` & `execute_modify_comment` (Feature 9): Two-step flow for hiding, unhiding, or deleting comments.
- **Lite CLI Utility**:
  - `refresh-token` (Feature 16 Lite): Exchanges existing access tokens for 60-day long-lived tokens and safely rewrites `.env` with zero token leakage in stdout/stderr.
- **Security & Infrastructure**:
  - Feature 17 (First Version): Structured JSON logging strictly directed to `stderr` to maintain clean MCP stdio framing; automatic secret scrubbing for tokens and keys; unified error hierarchy.
  - Feature 19: Environment configuration validation with Zod.
  - Multi-language monorepo structure, Docker Compose profiles, and baseline PostgreSQL migrations.
  - Independent GitHub Actions CI workflows for TypeScript, Go, Python, and Contracts drift.

### Security
- Destructive and public write actions cannot be executed directly by single tool calls or LLM hallucinations; all writes strictly require preview and confirmation token redemption.
- External comment content is quarantined as untrusted data.
