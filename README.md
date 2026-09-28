# MCB Server Instagram (`mcb-server-instagram`)

> [!IMPORTANT]
> **Non-Affiliation Disclaimer:** This project is an independent open-source tool and is not affiliated with, endorsed by, or sponsored by Meta Platforms, Inc. or Anthropic PBC. All product and company names are trademarks™ or registered® trademarks of their respective holders. Use of them does not imply any affiliation with or endorsement by them.

An MCP (Model Context Protocol) server that enables AI clients (such as Claude Desktop) to interact with an Instagram Professional (Business/Creator) account using the **official Meta / Instagram Graph APIs exclusively**.

Self-hosted and privacy-focused: every user runs the server with their own Meta App and credentials.

---

## Run Modes

The project supports two distinct operational modes:

| Feature | Lite Mode | Full Mode |
| :--- | :--- | :--- |
| **Requirements** | Node.js / TypeScript only (no Docker required) | Docker Compose (`docker compose up`) |
| **Components** | `mcp-server` (TypeScript) | `mcp-server`, `core-worker` (Go), `gateway` (Go), `media-ai` (Python), PostgreSQL |
| **Token Management** | Token in `.env` with manual CLI refresh (`refresh-token`) | Automated token refresh, encrypted at rest in PostgreSQL |
| **Read Tools** | Profile, Posts, Comments, Insights | Profile, Posts, Comments, Insights |
| **Write Tools** | Comment replies, hide/delete comments (2-step confirmation) | All Lite writes + media publishing, scheduling, DMs, automated rules |
| **Advanced Features** | None | Webhooks, auto-reply rules, media processing, AI captions & sentiment |

---

## How We Differ

A survey of existing Instagram MCP projects reveals common pitfalls: reliance on fragile reverse-engineered private APIs (e.g., `instagrapi`) that violate Meta Terms of Service and trigger account suspensions, unauthenticated monolithic scripts, or third-party hosted SaaS solutions requiring external credential sharing.

`mcb-server-instagram` provides an enterprise-grade, self-hosted alternative:

1. **Official Meta Graph API Exclusivity:** Strictly ToS-compliant. Operates exclusively against official Meta Graph API endpoints with official permissions. No private APIs, headless browsers, or unofficial scraping libraries.
2. **Dual-Mode Architecture (Lite vs. Full):**
   - **Lite Mode:** Zero Docker overhead. Runs purely as a TypeScript stdio server using local `.env` tokens, supporting immediate read tools and comment moderation.
   - **Full Mode:** Production microservices stack via Docker Compose (`core-worker` in Go, `gateway` in Go, `media-ai` in Python, PostgreSQL) powering queued publishing, scheduling, resilient webhooks, and media processing.
3. **Two-Step Confirmation Security Model:** Destructive or visible write actions (publishing, comment deletion/replies, direct messages) cannot be triggered accidentally by agent hallucinations or single tool calls. Every write operation requires a preview step that issues an ephemeral, one-time confirmation ID before execution.
4. **Zero-Token Internet Gateway:** External webhooks require a public-facing endpoint. Our internet-facing edge `gateway` service holds **zero Instagram access tokens**. It only verifies Meta webhook challenge handshakes and `X-Hub-Signature-256` HMAC signatures before inserting events into an internal database queue with insert-only permissions.

---

## Architecture

- **`mcp-server` (TypeScript):** Official `@modelcontextprotocol/sdk`, Zod schema validation, stdio transport. Exposes all tools to AI clients.
- **`core-worker` (Go):** Token refresh daemon, publish state machine (container -> poll processing -> publish), task scheduler, exponential backoff retries, daily insights snapshots, and webhook event processing.
- **`gateway` (Go):** A separate, lightweight, internet-facing proxy without access to Instagram API tokens. Handles Meta webhook verification (`hub.challenge`), validates `X-Hub-Signature-256` via constant-time comparison, limits payload size, and writes events to PostgreSQL.
- **`media-ai` (Python):** Media validation, video aspect-ratio conversion (FFmpeg/Pillow), optional AI captions/hashtags generation, and sentiment analysis via user-provided Claude API keys.
- **`database` (PostgreSQL):** Transactional queue with `FOR UPDATE SKIP LOCKED`, atomic daily quota counters, idempotency constraints, and encrypted token storage.

---

## Security Model

1. **Two-Step Confirmation Flow:** Every interactive write tool (publishing, scheduling, commenting, DMs) uses a two-phase commit: a preview tool yields the exact payload and an expiring one-time confirmation ID; the execute tool requires this valid ID.
2. **Untrusted Data Handling:** Comments, messages, and external inputs are treated strictly as data, never instructions.
3. **Token Isolation:** In Full mode, only `core-worker` has access to the encryption key and manages the token at rest. The `gateway` holds zero Instagram access credentials.

---

## Documentation

- Setup Guide: [docs/meta-setup.md](docs/meta-setup.md) (coming in Phase 0.3)
- Implementation Plan: [docs/PLAN.md](docs/PLAN.md)
- Security Policy: [SECURITY.md](SECURITY.md)

---

## License

MIT License. See [LICENSE](LICENSE) for details.
