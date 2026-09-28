# Security Policy

## Supported Versions

Only the latest release and the current `main` branch receive security updates.

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |
| < 0.1.0 | :x:                |

## Security Architecture & Best Practices

MCB Server Instagram handles access to Instagram Professional accounts via official Meta APIs. The following architectural rules protect integrity and privacy:

1. **Two-Step Confirmation Flow:** Every interactive write tool (publishing, scheduling, comment deletion/replies, direct messages) executes in two phases:
   - A preview step generates the exact proposed payload and an ephemeral confirmation ID.
   - An execute step requires this confirmation ID to perform the action.
2. **Untrusted Data Isolation:** All external inputs (comments, captions, DMs, incoming webhooks) are treated strictly as data, never as prompt instructions.
3. **Secret Protection:** 
   - Never log tokens or sensitive payload details in logs or error traces.
   - In Full mode, Instagram tokens are encrypted at rest using AES-GCM (with the encryption key provided exclusively to `core-worker`).
   - The internet-facing `gateway` holds zero Instagram access tokens.
4. **Rate Limiting & Quotas:** Enforced rate limits prevent accidental quota exhaustion or abuse of Meta API endpoints.

## Reporting a Vulnerability

If you discover a security vulnerability in this project:

1. **Do NOT open a public issue or discussion.**
2. Send a detailed report via GitHub Private Vulnerability Reporting or contact the maintainer directly.
3. Include:
   - Description of the vulnerability and its potential impact.
   - Exact steps or proof-of-concept to reproduce the issue.
   - Suggested mitigation or fix if available.

We appreciate responsible disclosure and will respond promptly to assess and remediate reported issues.
