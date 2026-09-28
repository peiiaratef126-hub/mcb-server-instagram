# MCB Server Instagram — Project Implementation Plan

## Overview
- **Name:** MCB Server Instagram
- **Slug:** `mcb-server-instagram`
- **Purpose:** Model Context Protocol (MCP) server enabling AI clients (e.g., Claude Desktop) to interact with Instagram Professional (Business/Creator) accounts using official Meta/Instagram Graph APIs exclusively.
- **License:** MIT (Self-hosted; not affiliated with Meta or Anthropic).
- **Run Modes:**
  - **Lite:** TypeScript `mcp-server` only, no Docker. Token in `.env` with a `refresh-token` CLI utility. Covers read tools and comment write tools.
  - **Full:** `docker compose up` orchestrates `core-worker` (Go), `gateway` (Go), `media-ai` (Python), and PostgreSQL (optional via profiles). Covers publishing, scheduling, webhooks, direct messages, auto-replies, and insights snapshots.

---

## Hard Rules

1. **Repo First, Private Always:**
   - Private repository on GitHub (`main` branch).
   - Safety files committed first (`.gitignore`, `.env.example`, `LICENSE`, `README.md`, `SECURITY.md`).
   - Secret scanning via manual `git diff --cached` review before every commit until tooling approved.
   - Never commit a real `.env`.
   - Never make the repo public or publish to registries (npm, ghcr.io, Releases) without explicit user approval.
   - Strict commit hygiene & atomicity: Conventional Commits with mandatory scope (`<type>(<scope>): <subject>`), one commit per feature/task, pushed immediately to the private remote.
2. **Official APIs Only:**
   - Exclusively official Meta / Instagram Graph API endpoints.
   - Verify endpoints, permissions, and rate limits against current Meta documentation before implementation.
3. **Provider Abstraction:**
   - Implement Facebook Login for Business path first (`graph.facebook.com`, linked Facebook Page).
   - Provider layer must decouple API client details so Instagram Login (`graph.instagram.com`, `instagram_business_*`) can be supported without changing MCP tools.
4. **Security Model:**
   - Interactive write tools require a two-step confirmation flow (preview tool returns action details + expiring confirmation ID; execute tool enforces valid ID).
   - Automated write paths (Feature 21 auto-reply) are OFF by default, use deterministic rules (never LLM), require explicit enable, have per-rule rate caps, and write audit logs.
   - External text (comments, DMs) is strictly untrusted data, never instructions.
   - Never log tokens. Full mode encrypts tokens at rest with AES-GCM.
   - AI features (22, 24) are OFF by default and require the user's Anthropic API key.
5. **Secrets & Manual Steps:**
   - Manual Meta app creation and setup documented in `docs/meta-setup.md`. Stop for user input to populate `.env`.
6. **Quality & Contracts:**
   - Dependency versions pinned via lockfiles.
   - CI with GitHub Actions for each language independently.
   - `contracts/` (OpenAPI + JSON Schema) as single source of truth for TypeScript, Go, and Python generated types. CI fails on drift.
7. **Testing Without a Token:**
   - Hand-written fixtures modeled after official Meta API documentation.
   - No real tokens in CI. Manual local smoke tests run by the user.
8. **Environment Verification:**
   - Verify Node.js, Go, Python, Docker, and FFmpeg prior to Phase 0.4.
9. **Persist the Plan:**
   - Maintain this plan in `docs/PLAN.md`, keeping status checklists updated across sessions.

---

## Architecture

- **`mcp-server` (TypeScript):** Official `@modelcontextprotocol/sdk`, Zod validation, stdio transport. Exposes all tools.
- **`core-worker` (Go):** Token refresh daemon, publish state machine (container -> poll processing -> publish), task scheduler, exponential backoff retries, daily insights snapshots, and webhook event processing.
- **`gateway` (Go):** Separate process/container from `core-worker`. Internet-facing proxy without access to Instagram API tokens. Handles Meta webhook verification (`hub.challenge`), validates `X-Hub-Signature-256` via constant-time comparison, limits payload size, and writes events to PostgreSQL.
- **`media-ai` (Python):** Media validation, video aspect-ratio conversion (FFmpeg/Pillow), optional AI captions/hashtags generation, and sentiment analysis via Claude API.
- **`database` (PostgreSQL):** Transactional queue with `FOR UPDATE SKIP LOCKED`, atomic daily quota counters, idempotency constraints, and encrypted token storage.
- **Token Ownership:**
  - **Lite Mode:** Token in `.env`.
  - **Full Mode:** `core-worker` is sole owner of token and encryption key. `mcp-server` requests decrypted token in-memory over internal network.

---

## Feature Index

| ID | Feature | Primary Component | Mode |
|---|---|---|---|
| 1 | Profile Info | `mcp-server` | Lite / Full |
| 2 | Recent Posts | `mcp-server` | Lite / Full |
| 3 | Post Details | `mcp-server` | Lite / Full |
| 4 | Publish Image | `core-worker` / `mcp-server` | Full |
| 5 | Publish Video/Reel | `core-worker` / `mcp-server` | Full |
| 6 | Carousel Post | `core-worker` / `mcp-server` | Full |
| 7 | List Comments | `mcp-server` | Lite / Full |
| 8 | Reply to Comment (2-step) | `mcp-server` | Lite / Full |
| 9 | Hide/Delete Comment (2-step) | `mcp-server` | Lite / Full |
| 10 | Account Insights | `mcp-server` | Lite / Full |
| 11 | Post Insights | `mcp-server` | Lite / Full |
| 12 | Mentions & Tags | `mcp-server` / `core-worker` | Full |
| 13 | Hashtag Search | `mcp-server` | Lite / Full (Roadmap) |
| 14 | Direct Messages | `core-worker` / `mcp-server` | Full |
| 15 | Post Scheduling | `core-worker` | Full |
| 16 | Automatic Token Refresh | `core-worker` | Full |
| 17 | Structured Logging & Errors | All components | Lite / Full |
| 18 | Rate Limits & Quotas | `core-worker` / `mcp-server` | Full |
| 19 | Environment Config (Zod) | `mcp-server` | Lite / Full |
| 20 | Webhooks Gateway | `gateway` | Full |
| 21 | Deterministic Auto-Reply Rules | `core-worker` | Full |
| 22 | AI Captions & Hashtags | `media-ai` | Full (Roadmap) |
| 23 | Best Time to Post | `media-ai` / `database` | Full (Roadmap) |
| 24 | Arabic & Multi-language Comment Sentiment | `media-ai` | Full (Roadmap) |
| 25 | Competitor Analysis (Business Discovery) | `mcp-server` | Lite / Full (Roadmap) |
| 26 | Web Dashboard | TypeScript / Web | Full (Roadmap) |
| 27 | Media Hosting & Ingestion | `media-ai` / `core-worker` | Full |
| 28 | Daily Insights Snapshot | `core-worker` / `database` | Full |

---

## Phases & Execution Status

### Phase 0: Foundation
- [x] **0.1 Repo & Safety Files:**
  - Git repository initialized on branch `main`.
  - Safety files created: `.gitignore`, `.env.example`, `LICENSE`, `README.md`, `SECURITY.md`.
  - Manual review of staged diff for secrets.
  - Initial safety commit created and pushed.
  - Private repository created (`peiiaratef126-hub/mcb-server-instagram`) and verified as `PRIVATE`.
  - Plan persisted to `docs/PLAN.md`.
- [x] **0.2 Survey of Existing Servers:** Survey GitHub Instagram MCP servers; document differentiators in `README.md`.
- [x] **0.3 Meta Setup Guide:** Write `docs/meta-setup.md`, then pause for manual user Meta App setup and `.env` population.
- [x] **0.4 Environment & Monorepo Setup:** Verify tools (Node, Go, Python, Docker, FFmpeg); monorepo structure, Docker Compose with profiles, PostgreSQL, `contracts/`, CI workflows.
- [x] **0.5 Configuration Validation:** Feature 19 (`.env` validation with Zod).
- [x] **0.6 Error Handling & Provider Abstraction:** Feature 17 v1 (structured logging, unified errors) and Graph API provider abstraction layer.
- [x] **Checkpoint 0 Confirmation**

### Phase 1: Read-Only Tools (TypeScript)
- [ ] Feature 1: Profile Info
- [ ] Feature 2: Recent Posts
- [ ] Feature 3: Post Details
- [ ] Feature 7: List Comments
- [ ] Feature 10: Account Insights
- [ ] Feature 11: Post Insights
- [ ] Hand-written fixtures & unit test suite
- [ ] **Checkpoint 1 Confirmation**

### Phase 2: Comment Writes & Lite Release
- [ ] Feature 8: Reply to Comment (2-step confirmation flow)
- [ ] Feature 9: Hide/Delete Comment (2-step confirmation flow)
- [ ] CLI command: `refresh-token` for Lite mode
- [ ] Prepare release v0.1 (CHANGELOG, version bump, release notes; no external publishing)
- [ ] **Checkpoint 2 Confirmation**

### Phase 3: Persistent Service & Go Worker
- [ ] PostgreSQL schema & migrations (publish queue, quota counter, constraints)
- [ ] Feature 16: Worker token import, encryption at rest (AES-GCM), auto-refresh daemon
- [ ] Feature 18: Rate limiting & quota enforcement
- [ ] Feature 17 (Full): Worker structured logging & error pipeline
- [ ] Feature 28: Daily insights snapshot runner
- [ ] Exactly-once queue processing test with concurrent workers
- [ ] **Checkpoint 3 Confirmation**

### Phase 4: Media & Publishing
- [ ] Feature 27: Media hosting & upload flow (resumable vs URL)
- [ ] Python `media-ai` validation & aspect ratio conversion
- [ ] Feature 4: Publish Image
- [ ] Feature 5: Publish Video/Reel
- [ ] Feature 6: Carousel Post
- [ ] Feature 15: Post Scheduling
- [ ] Media validation tests (invalid size/aspect ratio) & end-to-end publish flow test
- [ ] Prepare release v0.2 (CHANGELOG, version bump, release notes; no external publishing)
- [ ] **Checkpoint 4 Confirmation**

### Phase 5: Realtime & Engagement
- [ ] Feature 20: Go `gateway` service (signature verification, challenge handshake, rate/body limits)
- [ ] Webhook event processor in `core-worker`
- [ ] Feature 12: Mentions & Tags
- [ ] Feature 14: Direct Messages
- [ ] Feature 21: Deterministic auto-reply rules (rate-capped, audit-logged, opt-in)
- [ ] Security tests (forged signature rejection, oversized body rejection)
- [ ] Prepare release v0.3 (CHANGELOG, version bump, release notes; no external publishing)
- [ ] **Checkpoint 5 Confirmation**

### Phase 6–9: Roadmap (On user instruction only)
- [ ] Phase 6: Features 13 (Hashtags), 25 (Competitor analysis)
- [ ] Phase 7: Features 23 (Best time), 24 (Sentiment), 22 (AI captions)
- [ ] Phase 8: Feature 26 (Web dashboard)
- [ ] Phase 9: v1.0 Polish, Docker images build-check, `CONTRIBUTING.md`
