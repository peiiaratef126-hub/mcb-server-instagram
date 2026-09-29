# Contributing to MCB Server Instagram

Thank you for your interest in contributing to `mcb-server-instagram`! We welcome contributions, bug fixes, feature proposals, and documentation enhancements that align with our core values: **strict adherence to official Meta Graph APIs**, **zero-token security isolation**, **two-step confirmation for destructive actions**, and **clean multi-language architecture**.

---

## Code of Conduct

Please treat all contributors and community members with respect, dignity, and empathy. Harassment, discrimination, or abusive conduct will not be tolerated.

---

## Development Environment Setup

This repository is organized as a multi-language monorepo:
- **`apps/mcp-server`**: TypeScript / Node.js (MCP Server, Tool registry, Web Dashboard)
- **`services/core-worker`**: Go 1.24+ (Background queue processor, token refresh daemon, quota tracking)
- **`services/gateway`**: Go 1.24+ (Zero-token edge webhook receiver with HMAC validation)
- **`services/media-ai`**: Python 3.12+ (Pillow, FFmpeg media validation, sentiment analysis, caption optimization)
- **`packages/contracts`**: JSON Schemas for cross-language validation

### Prerequisites
- Node.js 20+ and npm 10+
- Go 1.24+
- Python 3.12+ with `venv`
- FFmpeg (for media transcoding & validation)
- Docker & Docker Compose (optional for local full mode testing)

---

## Coding Standards & Conventions

### 1. TypeScript (`apps/mcp-server`)
- Use strict TypeScript typing; avoid `any`.
- Define input parameters using **Zod** schemas.
- Ensure all MCP tools declare explicit hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`).
- Follow the two-step confirmation pattern for any mutation or external action:
  - `preview_<action>`: Validates input, constructs payload, generates a signed `confirmation_id` with SHA-256 payload hash and TTL.
  - `execute_<action>`: Validates `confirmation_id`, tool binding, and payload hash before dispatching.
- Use the structured logger ([`apps/mcp-server/src/utils/logger.ts`](file:///C:/Users/Al-Mahdi/mcb-server-instagram/apps/mcp-server/src/utils/logger.ts)) with automatic secret scrubbing.

### 2. Go (`services/core-worker` & `services/gateway`)
- Follow standard Go project structure (`cmd/`, `internal/`).
- Use Go 1.21+ structured logging (`log/slog`) with our custom `ScrubberHandler` that redacts tokens, secrets, nonces, and passwords.
- Database queries that claim background jobs must use `SELECT ... FOR UPDATE SKIP LOCKED` inside transactions to guarantee exactly-once execution.
- Webhook signature checks must use `crypto/hmac` and `crypto/subtle.ConstantTimeCompare`.
- Format all code with `gofmt -s -w .` before submitting.

### 3. Python (`services/media-ai`)
- Structure packages cleanly under `media_ai/`.
- Validate data models with **Pydantic v2**.
- Use type hints on all function signatures.
- Adhere to PEP 8 styling conventions.

---

## Testing Guidelines

Every change must include automated tests verifying behavior and edge cases. Never commit changes with failing tests.

### Running Test Suites Locally

```bash
# 1. TypeScript Tests (apps/mcp-server)
cd apps/mcp-server
npm test
npm run build

# 2. Go Tests (core-worker & gateway)
cd ../../services/core-worker
go test -v ./...
cd ../gateway
go test -v ./...

# 3. Python Tests (media-ai)
cd ../media-ai
python -m pytest tests/
```

### Writing Hand-Written Meta API Fixtures
Meta Graph API responses should be mocked using realistic hand-written JSON fixtures modeled after official Meta Graph API documentation. **Never** include real production credentials or personal access tokens in test fixtures.

---

## Commit Hygiene & Git Conventions

We enforce atomic Conventional Commits:
```text
<type>(<scope>): <short description in present tense>
```

### Types:
- `feat`: A new feature or MCP tool
- `fix`: A bug fix
- `docs`: Documentation updates
- `test`: Adding or updating test suites
- `refactor`: Code changes that neither fix bugs nor add features
- `chore`: Build scripts, dependencies, or configuration updates

### Scopes:
- `mcp-server`, `core-worker`, `gateway`, `media-ai`, `repo`, `ci`, `docs`

### Rules:
- Make small, atomic commits addressing one feature or fix at a time.
- Review `git diff --cached` before committing to prevent accidental secret or log inclusions.
- **NEVER** commit `.env` files or API secrets.

---

## Pull Request Guidelines

1. Fork the repository and create a descriptive feature branch (`feature/your-feature-name` or `fix/issue-description`).
2. Implement your changes, adhering to code formatting and commit hygiene.
3. Run the full test suite across all 4 runtimes to ensure everything passes locally.
4. Push your branch to your fork and submit a Pull Request against `main`.
5. In the PR description, explain:
   - What problem is being solved.
   - Which tools or services were modified.
   - Proof of test execution (test command outputs).
   - Any Meta documentation consulted.

---

## Security Disclosures

If you discover a security vulnerability or credential handling flaw, please do **NOT** open a public issue. Review [SECURITY.md](SECURITY.md) for instructions on confidential reporting.
