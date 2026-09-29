# Production Deployment & Operations Guide

This guide describes how to run and deploy `mcb-server-instagram` in both **Lite Mode** (zero-dependency stdio / SSE for desktop LLMs) and **Full Mode** (distributed multi-service stack with background job queue, AES-256-GCM encrypted persistence, edge webhook gateway, and media optimization engine).

---

## Architecture Modes Comparison

| Feature / Capability | Lite Mode | Full Mode |
| :--- | :--- | :--- |
| **Execution Environment** | Local process (Node.js) | Distributed Docker Compose / Kubernetes |
| **Dependencies** | None (in-memory) | PostgreSQL 16+, Valkey/Redis (optional), FFmpeg, Python 3.12+ |
| **Transport** | stdio (Claude Desktop / Cursor) or local SSE | HTTP / SSE / REST / Webhook Edge Gateway |
| **Tools Available** | All 30 MCP tools | All 30 MCP tools |
| **Publishing Flow** | Synchronous container creation | Asynchronous DB queue with worker polling & retry |
| **Post Scheduling** | Direct delayed trigger / in-process | Persistent PostgreSQL `publish_queue` with `SKIP LOCKED` |
| **Token Storage** | Memory / Environment variable | AES-256-GCM encrypted at rest in PostgreSQL |
| **Token Refresh** | In-process or CLI command | Background daemon with automated 60-day renewal |
| **Rate Limiting** | In-memory token-bucket | Atomic database quotas with automatic rolling window |
| **Webhooks** | Not available | Real-time edge gateway with HMAC SHA-256 signature checks |
| **Web Dashboard** | Embedded at `http://localhost:3000/dashboard` | Embedded or reverse-proxied behind TLS |

---

## 1. Lite Mode Quickstart (Claude Desktop & Standalone)

Lite mode requires only Node.js 20+ and your Meta credentials. No databases, Redis, or background daemons are needed.

### Step 1.1: Clone and Build
```bash
git clone https://github.com/peiiaratef126-hub/mcb-server-instagram.git
cd mcb-server-instagram/apps/mcp-server
npm install
npm run build
```

### Step 1.2: Configure `.env`
Create `.env` inside `apps/mcp-server/` (or root):
```env
RUN_MODE=lite
INSTAGRAM_ACCOUNT_ID=17841400000000000
INSTAGRAM_ACCESS_TOKEN=EAAG...
# Optional: enable Claude-powered caption and sentiment tools
ANTHROPIC_API_KEY=sk-ant-...
# Optional: embedded dashboard (defaults to true on port 3000)
DASHBOARD_ENABLED=true
DASHBOARD_PORT=3000
```

### Step 1.3: Connect to Claude Desktop
Add `mcb-server-instagram` to your `claude_desktop_config.json`:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "instagram": {
      "command": "node",
      "args": [
        "/path/to/mcb-server-instagram/apps/mcp-server/dist/index.js"
      ],
      "env": {
        "RUN_MODE": "lite",
        "INSTAGRAM_ACCOUNT_ID": "17841400000000000",
        "INSTAGRAM_ACCESS_TOKEN": "EAAG...",
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Restart Claude Desktop. All 30 tools will be recognized immediately.

---

## 2. Full Mode Production Setup via Docker Compose

In Full Mode, the system runs as 5 coordinated services:
1. `mcp-server` (Node.js): MCP interface, dashboard, and tool coordinator.
2. `core-worker` (Go): Token encryption, token refresh daemon, quota manager, and scheduled publishing engine.
3. `gateway` (Go): Zero-token edge webhook receiver with HMAC signature verification.
4. `media-ai` (Python): Media validation, aspect ratio transcoding via FFmpeg, and Claude AI service.
5. `postgres` (PostgreSQL 16): Persistent relational store with relational schemas.

```
                  ┌──────────────────────┐
                  │   Claude / Client    │
                  └──────────┬───────────┘
                             │ stdio / SSE
                  ┌──────────▼───────────┐
                  │      mcp-server      │◄──────────┐
                  │    (Node.js / TS)    │           │
                  └─────┬───────────┬────┘           │
         gRPC / HTTP    │           │                │ Internal
        Media Pipeline  │           │ DB Queue       │ Token RPC
     ┌──────────────────┘           └─────────┐      │
     ▼                                        ▼      ▼
┌──────────────┐                       ┌──────────────┐
│   media-ai   │                       │ core-worker  │
│(Python/FFmpeg│                       │  (Go Worker) │
└──────────────┘                       └──────┬───────┘
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      │                                               │
                      ▼                                               ▼
               ┌──────────────┐                                ┌──────────────┐
               │  PostgreSQL  │                                │ Meta API v21 │
               │ (Encrypted)  │                                │  (Published) │
               └──────▲───────┘                                └──────────────┘
                      │
                      │ DB Queue Events
               ┌──────┴───────┐
               │   gateway    │◄─── Meta Webhooks (HMAC SHA-256)
               │ (Go Edge GW) │
               └──────────────┘
```

### Step 2.1: Production `.env` Configuration
Generate your secure 32-byte encryption key and webhook verify token:
```bash
# Generate 32-byte hex encryption key
openssl rand -hex 32

# Generate random webhook verify token
openssl rand -hex 24
```

Populate the production `.env`:
```env
# Operational Mode
RUN_MODE=full
APP_ENV=production
LOG_LEVEL=info

# Meta Graph API Credentials
INSTAGRAM_ACCOUNT_ID=17841400000000000
INSTAGRAM_ACCESS_TOKEN=EAAG...
META_APP_ID=123456789012345
META_APP_SECRET=your_meta_app_secret

# Security & Encryption
TOKEN_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
WEBHOOK_VERIFY_TOKEN=your_webhook_verify_token_here

# PostgreSQL Persistence
POSTGRES_USER=mcb_admin
POSTGRES_PASSWORD=generate_a_strong_db_password
POSTGRES_DB=mcb_instagram
DATABASE_URL=postgresql://mcb_admin:generate_a_strong_db_password@postgres:5432/mcb_instagram?sslmode=disable

# AI & Media Optimization (Optional)
ANTHROPIC_API_KEY=sk-ant-...

# Networking
PORT=3000
GATEWAY_PORT=8080
MEDIA_AI_PORT=8000
```

### Step 2.2: Launch the Cluster
```bash
# Build and start all services in detached mode
docker compose up -d --build

# Verify container health
docker compose ps
```

All migrations in `services/core-worker/migrations/` apply automatically upon PostgreSQL initialization.

### Step 2.3: Check Service Health
- **MCP Server Health:** `curl -f http://localhost:3000/health`
- **Gateway Health:** `curl -f http://localhost:8080/health`
- **Media AI Health:** `curl -f http://localhost:8000/health`
- **Dashboard:** Open `http://localhost:3000/dashboard` in your browser.

---

## 3. Production HTTPS Tunneling for Meta Webhooks

Meta requires a public, valid HTTPS URL with a valid TLS certificate for webhook delivery. In self-hosted or private network setups, route traffic securely to the edge `gateway` service (port `8080`).

### Option A: Cloudflare Tunnel (Recommended for Production)
Cloudflare Tunnel exposes your local edge gateway to a public HTTPS domain without opening firewall ports or port-forwarding.

1. Install `cloudflared`:
   ```bash
   brew install cloudflared # macOS
   # Or download Linux / Windows binary from Cloudflare
   ```
2. Authenticate and create a tunnel:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create mcb-instagram
   ```
3. Configure `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: <TUNNEL_UUID>
   credentials-file: /etc/cloudflared/<TUNNEL_UUID>.json

   ingress:
     - hostname: webhook.yourdomain.com
       service: http://localhost:8080
     - service: http_status:404
   ```
4. Start tunnel daemon:
   ```bash
   cloudflared tunnel run mcb-instagram
   ```
5. In Meta App Dashboard, set **Callback URL** to `https://webhook.yourdomain.com/webhook`.

### Option B: Caddy Reverse Proxy (Direct Public Server)
If hosting on a VPS or cloud instance with a public IP, Caddy automatically provisions and renews Let's Encrypt certificates:

```caddyfile
# /etc/caddy/Caddyfile
webhook.yourdomain.com {
    reverse_proxy localhost:8080 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}

dashboard.yourdomain.com {
    basicauth {
        admin $2a$14$... # generated via caddy hash-password
    }
    reverse_proxy localhost:3000
}
```

### Option C: ngrok (Development & Testing)
For quick local testing of webhook events:
```bash
ngrok http 8080
```
Copy the forwarding HTTPS URL (e.g. `https://abc-123.ngrok-free.app`) and configure `https://abc-123.ngrok-free.app/webhook` in Meta Developer Portal.

---

## 4. Maintenance & Operations

### Monitoring Logs
```bash
# Follow consolidated logs
docker compose logs -f

# Follow specific service logs
docker compose logs -f gateway
docker compose logs -f core-worker
```

All logs are automatically filtered through the zero-token scrubber handler before emission.

### Manual Token Extension CLI
If running standalone without the Go worker daemon, refresh long-lived tokens using the built-in CLI:
```bash
npm --prefix apps/mcp-server run refresh-token
```

### Database Backup & Restore
```bash
# Backup encrypted database
docker compose exec postgres pg_dump -U mcb_admin mcb_instagram > backup_$(date +%Y%m%d).sql

# Restore from backup
cat backup_20260929.sql | docker compose exec -T postgres psql -U mcb_admin mcb_instagram
```
