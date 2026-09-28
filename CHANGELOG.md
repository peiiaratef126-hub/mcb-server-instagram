# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
