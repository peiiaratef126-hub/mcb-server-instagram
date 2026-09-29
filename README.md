# MCB Server Instagram (`mcb-server-instagram`)

[![CI Matrix](https://github.com/peiiaratef126-hub/mcb-server-instagram/actions/workflows/ci.yml/badge.svg)](https://github.com/peiiaratef126-hub/mcb-server-instagram/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP Specification](https://img.shields.io/badge/MCP-v1.6.1-blue.svg)](https://modelcontextprotocol.io)

> [!IMPORTANT]
> **Non-Affiliation Disclaimer:** This project is an independent open-source tool and is not affiliated with, endorsed by, or sponsored by Meta Platforms, Inc. or Anthropic PBC. All product and company names are trademarks™ or registered® trademarks of their respective holders. Use of them does not imply any affiliation with or endorsement by them.

`mcb-server-instagram` is an enterprise-grade, privacy-first **Model Context Protocol (MCP)** server enabling AI assistants (such as Claude Desktop, Cursor, and custom agentic systems) to manage Instagram Professional (Business and Creator) accounts using **official Meta Graph APIs exclusively**.

---

## Key Highlights

- **100% Official Meta Graph API v21.0:** Strictly ToS-compliant. Never relies on reverse-engineered private APIs (e.g. `instagrapi`) or headless browser automation that risk account bans.
- **Dual Operational Modes:** Runs in lightweight zero-dependency **Lite Mode** (direct stdio/SSE for Claude Desktop) or production **Full Mode** (distributed multi-service stack with background worker, database queue, and edge gateway).
- **Two-Step Confirmation Security:** All destructive or externally visible write actions (publishing, comment moderation, direct messaging) require a cryptographic preview and execution flow to prevent unintended actions from AI hallucinations.
- **Zero-Token Edge Gateway:** The internet-facing webhook listener holds **zero access tokens**, eliminating token exposure risks on public ingress endpoints.
- **AES-256-GCM Token Encryption at Rest:** Long-lived access tokens are encrypted with authenticated AES-GCM before database persistence, refreshed automatically by a background daemon.
- **Embedded Web Dashboard:** Self-contained glassmorphic analytics dashboard showing live quotas, queue health, 7×24 best posting time heatmaps, and sanitized audit trails.
- **AI Content Intelligence:** Optional AI caption generation, hashtag discovery, and comment sentiment analysis with Arabic dialect support (Egyptian, Gulf, Levantine, Maghrebi).

---

## System Architecture

```mermaid
flowchart TD
    subgraph ClientLayer ["AI Clients & Management"]
        Claude["Claude Desktop / Cursor / LLM Agent"]
        Browser["Web Browser (Operator)"]
    end

    subgraph AppServer ["MCP Application Server (apps/mcp-server)"]
        MCPServer["MCP Protocol Server (stdio / SSE)"]
        Dashboard["Web Dashboard (Port 3000)"]
        ConfirmStore["Two-Step Confirmation Store"]
        TokenBucket["In-Memory Rate Limiter"]
    end

    subgraph ProductionServices ["Full Mode Microservices"]
        Worker["Core Worker (Go)\n- Token Daemon\n- Job Dispatcher\n- Daily Quota Tracker"]
        Gateway["Gateway Edge (Go)\n- Port 8080 (Public)\n- Zero Token Isolation\n- HMAC SHA-256 Validation"]
        MediaAI["Media AI Service (Python)\n- Pillow Aspect Ratios\n- FFmpeg Video Transcoding\n- Claude Sentiment & Captions"]
    end

    subgraph DataStore ["Persistence Layer"]
        Postgres[(PostgreSQL 16)\n- Encrypted Tokens\n- Publish Queue SKIP LOCKED\n- Quotas & Insights]
    end

    subgraph ExternalServices ["External Cloud APIs"]
        MetaGraph["Meta Graph API v21.0\n(Instagram Graph Endpoints)"]
        AnthropicAPI["Claude API\n(Sentiment & Captions)"]
    end

    Claude -->|stdio / SSE| MCPServer
    Browser -->|HTTP| Dashboard
    MCPServer -->|Preview & Verify| ConfirmStore
    MCPServer -->|Direct Graph Calls (Lite)| MetaGraph
    MCPServer -->|Async Queue (Full)| Postgres

    Worker -->|FOR UPDATE SKIP LOCKED| Postgres
    Worker -->|Container Publishing| MetaGraph
    Worker -->|Token Refresh| MetaGraph
    
    MetaGraph -->|Webhooks HTTPS| Gateway
    Gateway -->|Insert Event Queue| Postgres

    MCPServer -.->|Transcode & Optimize| MediaAI
    MediaAI -.->|Sentiment & Captions| AnthropicAPI
```

---

## 30 Registered MCP Tools & Feature Matrix

The server exposes 30 MCP tools covering the complete lifecycle of Instagram operations:

| Tool Category | # | MCP Tool Name | Required Scope | Safety Annotations | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Profile & Feed** | 1 | `get_profile_info` | `instagram_basic` | Read-Only, Idempotent | Fetch account biography, follower counts, and media counters. |
| | 2 | `get_recent_posts` | `instagram_basic` | Read-Only, Idempotent | Retrieve chronological feed posts with engagement statistics. |
| | 3 | `get_post_details` | `instagram_basic` | Read-Only, Idempotent | Query full post metadata, permanent links, and media type. |
| **Comments & Moderation** | 4 | `list_comments` | `instagram_basic` | Read-Only, Idempotent | List top-level comments and replies for a media object. |
| | 5 | `preview_reply_comment` | *None* | Read-Only | Validate comment reply text and issue two-step confirmation token. |
| | 6 | `execute_reply_comment` | `instagram_manage_comments` | Destructive | Post validated reply to a specific comment thread. |
| | 7 | `preview_modify_comment` | *None* | Read-Only | Validate comment hide/unhide/delete action and issue confirmation token. |
| | 8 | `execute_modify_comment` | `instagram_manage_comments` | Destructive | Execute hide, unhide, or permanent deletion of a comment. |
| **Insights & Analytics** | 9 | `get_account_insights` | `instagram_manage_insights` | Read-Only, Idempotent | Retrieve daily reach, impressions, and follower growth trends. |
| | 10 | `get_post_insights` | `instagram_manage_insights` | Read-Only, Idempotent | Retrieve post impressions, engagement, reach, and video views. |
| | 11 | `get_best_time_to_post` | `instagram_manage_insights` | Read-Only, Idempotent | Analyze historical post engagement into a 7×24 heatmap ranking. |
| **Media Publishing** | 12 | `preview_publish_image` | *None* | Read-Only | Validate aspect ratios (4:5 to 1.91:1) and generate confirmation token. |
| | 13 | `execute_publish_image` | `instagram_content_publish` | Destructive | Create media container and publish image to feed. |
| | 14 | `preview_publish_video` | *None* | Read-Only | Validate video duration, codec, and generate confirmation token. |
| | 15 | `execute_publish_video` | `instagram_content_publish` | Destructive | Create Reels/video container and publish upon readiness. |
| | 16 | `preview_publish_carousel` | *None* | Read-Only | Validate 2-10 items list and generate confirmation token. |
| | 17 | `execute_publish_carousel` | `instagram_content_publish` | Destructive | Create child items and publish carousel post. |
| | 18 | `preview_schedule_post` | *None* | Read-Only | Validate scheduled publication timestamp (15m to 75d window). |
| | 19 | `execute_schedule_post` | `instagram_content_publish` | Destructive | Enqueue scheduled post in persistent database queue for worker dispatch. |
| **Audience & Mentions** | 20 | `get_user_tags` | `instagram_basic` | Read-Only, Idempotent | Retrieve photos and videos where the account is tagged. |
| | 21 | `get_mentions` | `instagram_basic`, `instagram_manage_comments` | Read-Only, Idempotent | Monitor public captions and comments mentioning account handle. |
| **Direct Messages** | 22 | `list_conversations` | `instagram_manage_messages` | Read-Only, Idempotent | Enumerate active direct message conversation threads. |
| | 23 | `get_conversation_messages`| `instagram_manage_messages` | Read-Only, Idempotent | Fetch message history within a conversation thread. |
| | 24 | `preview_send_dm` | *None* | Read-Only | Validate recipient ID, message text, and generate confirmation token. |
| | 25 | `execute_send_dm` | `instagram_manage_messages` | Destructive | Dispatch direct message within Meta 24-hour messaging window. |
| **Discovery & Intel** | 26 | `search_hashtag` | `instagram_basic` | Read-Only, Idempotent | Search Meta Graph API to resolve a hashtag ID. |
| | 27 | `get_hashtag_media` | `instagram_basic` | Read-Only, Idempotent | Fetch top or recent public media objects for a hashtag. |
| | 28 | `get_competitor_profile` | `instagram_basic` | Read-Only, Idempotent | Fetch competitor/creator public profiles via Business Discovery API. |
| **AI Content Optimization** | 29 | `analyze_comment_sentiment`| *None (Claude API / Local)* | Read-Only, Idempotent | Classify sentiment (positive/neutral/negative/urgent) with Arabic dialect support. |
| | 30 | `generate_caption_and_hashtags`| *None (Claude API / Local)*| Read-Only, Idempotent | Generate targeted multilingual captions, hooks, and hashtags from brief. |

---

## Operational Modes

### Comparison

| Feature | Lite Mode | Full Mode |
| :--- | :--- | :--- |
| **Primary Use Case** | Local desktop AI assistant (Claude Desktop, Cursor) | Always-on production server & team automation |
| **Infrastructure** | Node.js 20+ process (no external databases) | Docker Compose (PostgreSQL, Go, Python, Node.js) |
| **Transport** | stdio (default) or SSE | HTTP / SSE / Webhook Gateway |
| **Token Handling** | Static `.env` with CLI refresh tool | AES-256-GCM encrypted in DB with auto-refresh daemon |
| **Queueing & Scheduling**| In-memory / direct synchronous | Persistent PostgreSQL `publish_queue` with `SKIP LOCKED` |
| **Webhooks** | Unsupported (requires public endpoint) | Dedicated zero-token Go edge gateway |
| **Web Dashboard** | Available locally (`http://localhost:3000/dashboard`) | Available with reverse proxy / authentication |

---

## Quickstart

### 1. Lite Mode (Claude Desktop)

1. **Clone and Build:**
   ```bash
   git clone https://github.com/peiiaratef126-hub/mcb-server-instagram.git
   cd mcb-server-instagram/apps/mcp-server
   npm install
   npm run build
   ```

2. **Configure Credentials:**
   Create `.env` in `apps/mcp-server/`:
   ```env
   RUN_MODE=lite
   INSTAGRAM_ACCOUNT_ID=17841400000000000
   INSTAGRAM_ACCESS_TOKEN=EAAG...
   ```
   *(See [docs/meta-setup.md](docs/meta-setup.md) for step-by-step instructions on obtaining credentials).*

3. **Add to Claude Desktop:**
   Edit your `claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "instagram": {
         "command": "node",
         "args": [
           "/absolute/path/to/mcb-server-instagram/apps/mcp-server/dist/index.js"
         ],
         "env": {
           "RUN_MODE": "lite",
           "INSTAGRAM_ACCOUNT_ID": "17841400000000000",
           "INSTAGRAM_ACCESS_TOKEN": "EAAG..."
         }
       }
     }
   }
   ```
   Restart Claude Desktop. All 30 tools will be active.

---

### 2. Full Mode (Docker Compose)

1. **Configure Environment:**
   Copy `.env.example` to `.env` in the repository root:
   ```bash
   cp .env.example .env
   ```
   Generate a 32-byte hex encryption key:
   ```bash
   openssl rand -hex 32
   ```
   Set `RUN_MODE=full`, `TOKEN_ENCRYPTION_KEY`, `WEBHOOK_VERIFY_TOKEN`, and your Meta credentials in `.env`.

2. **Launch Cluster:**
   ```bash
   docker compose up -d --build
   ```

3. **Verify Health:**
   - MCP Server: `http://localhost:3000/health`
   - Edge Gateway: `http://localhost:8080/health`
   - Web Dashboard: `http://localhost:3000/dashboard`

*(For production tunneling and reverse proxy setup, see [docs/deployment.md](docs/deployment.md)).*

---

## Security Model

1. **Two-Step Confirmation:** Destructive tools require a valid `confirmation_id` issued by the corresponding `preview_*` tool within a 5-minute TTL. The confirmation is cryptographically bound to the tool name and payload hash.
2. **Zero-Token Gateway:** The public webhook edge service runs completely isolated without Instagram API credentials.
3. **Automated Secret Scrubbing:** Structured loggers across TypeScript and Go automatically redact tokens, secrets, nonces, and passwords before logging or emitting payloads.
4. **Untrusted Data Sanitization:** All incoming user comments, messages, and hashtags are treated as untrusted text data and wrapped safely to prevent prompt injection attacks against LLMs.

For full details, review [SECURITY.md](SECURITY.md).

---

## Documentation Index

- [Meta App & Instagram Setup Guide](docs/meta-setup.md): Complete permissions guide and step-by-step token generation.
- [Production Deployment Guide](docs/deployment.md): Lite vs Full mode, Docker Compose, and Cloudflare Tunnel / Caddy setups.
- [Media Upload & Hosting Specifications](docs/media-upload.md): Meta Graph API v21.0 container upload and aspect ratio requirements.
- [Webhooks Architecture & Guide](docs/webhooks.md): Edge gateway isolation, HMAC signature verification, and event schemas.
- [Contributing Guide](CONTRIBUTING.md): Code standards, atomic commit hygiene, and multi-language test execution.
- [Security Policy](SECURITY.md): Vulnerability reporting procedures and data protection standards.
- [Implementation Plan](docs/PLAN.md): Completed milestone roadmap from Foundation to v1.0.

---

## License

This project is licensed under the [MIT License](LICENSE).
