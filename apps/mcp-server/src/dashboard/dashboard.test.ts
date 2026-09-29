import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { MockInstagramGraphProvider } from "../providers/mock-provider.js";
import { createDashboardServer, startDashboard } from "./index.js";
import { sanitizePayload, DashboardDataProvider } from "./data-provider.js";

describe("Feature 26: Web Dashboard Server & Security", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const mockProvider = new MockInstagramGraphProvider();
    // Port 0 lets OS choose an open ephemeral port
    const started = await startDashboard(mockProvider, { port: 0, mode: "lite" });
    server = started.server;
    baseUrl = `http://127.0.0.1:${started.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("serves responsive HTML dashboard on GET /dashboard with security headers", async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    // Strict security headers
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");

    const html = await res.text();
    expect(html).toContain("MCB Server Instagram");
    expect(html).toContain("@official_brand_test");
    expect(html).toContain("Daily Meta Quotas &amp; Limits");
    expect(html).toContain("Best Time to Post");
    expect(html).toContain("Publish Queue Status");
    expect(html).toContain("Recent Automated Actions &amp; Moderation Logs");
  });

  it("serves sanitized JSON on GET /api/status", async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const json = (await res.json()) as any;
    expect(json.account.username).toBe("official_brand_test");
    expect(json.quotas.quotas.length).toBeGreaterThan(0);
    expect(json.best_time.heatmap.length).toBe(7);
    expect(json.best_time.heatmap[0].length).toBe(24);
    expect(json.queue.length).toBeGreaterThan(0);
    expect(json.audit_logs.length).toBeGreaterThan(0);
  });

  it("serves individual JSON endpoints (/api/quotas, /api/queue, /api/heatmap)", async () => {
    const resQuotas = await fetch(`${baseUrl}/api/quotas`);
    expect(resQuotas.status).toBe(200);
    const quotasJson = (await resQuotas.json()) as any;
    expect(quotasJson.quotas).toBeInstanceOf(Array);

    const resQueue = await fetch(`${baseUrl}/api/queue`);
    expect(resQueue.status).toBe(200);
    const queueJson = (await resQueue.json()) as any;
    expect(queueJson).toBeInstanceOf(Array);

    const resHeatmap = await fetch(`${baseUrl}/api/heatmap`);
    expect(resHeatmap.status).toBe(200);
    const heatmapJson = (await resHeatmap.json()) as any;
    expect(heatmapJson.heatmap.length).toBe(7);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`${baseUrl}/api/nonexistent`);
    expect(res.status).toBe(404);
  });

  describe("STRICT ZERO-TOKEN SECURITY SANITIZATION", () => {
    it("scrubs tokens, secrets, nonces, and passwords from object payloads", () => {
      const contaminated = {
        user: "admin",
        access_token: "EAAG_super_sensitive_token_12345",
        client_secret: "meta_secret_abcdef987654",
        nonce: "crypto_nonce_random_bytes",
        encryption_key: "32_byte_aes_key",
        nested: {
          auth_token: "EAAG_another_token_99999",
          user_password: "mypassword123",
          safe_message: "Here is a token EAAG_in_a_string_sample",
        },
      };

      const sanitized = sanitizePayload(contaminated);

      expect(sanitized.access_token).toBe("[REDACTED]");
      expect(sanitized.client_secret).toBe("[REDACTED]");
      expect(sanitized.nonce).toBe("[REDACTED]");
      expect(sanitized.encryption_key).toBe("[REDACTED]");
      expect(sanitized.nested.auth_token).toBe("[REDACTED]");
      expect(sanitized.nested.user_password).toBe("[REDACTED]");
      expect(sanitized.nested.safe_message).toBe("Here is a token [REDACTED_ACCESS_TOKEN]");
      expect(sanitized.user).toBe("admin");
    });

    it("verifies dashboard HTML output contains zero token occurrences", async () => {
      const res = await fetch(`${baseUrl}/dashboard`);
      const html = await res.text();

      expect(html).not.toMatch(/EAAG[A-Za-z0-9_-]+/);
      expect(html).not.toMatch(/sk-ant-[A-Za-z0-9_-]+/);
      expect(html).not.toContain("access_token");
      expect(html).not.toContain("token_ciphertext");
    });
  });
});
