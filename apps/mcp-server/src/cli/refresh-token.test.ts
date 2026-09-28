import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  refreshLongLivedToken,
  updateEnvFileToken,
  runRefreshTokenCli,
  DEFAULT_GRAPH_VERSION,
} from "./refresh-token.js";
import { AuthenticationError, BaseError } from "../errors/index.js";

describe("Lite Mode CLI: refresh-token (Feature 16 Lite)", () => {
  const SECRET_TOKEN = "EAAG_super_sensitive_token_never_leak_xyz_12345";
  const SECRET_APP_SECRET = "super_secret_meta_app_secret_998877";
  const APP_ID = "123456789012345";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Token Refresh & Graph API Versioning", () => {
    it("should exchange token using default Graph API version v21.0", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "EAAG_refreshed_new_token_11111",
          expires_in: 5184000,
        }),
      });

      const res = await refreshLongLivedToken({
        currentToken: SECRET_TOKEN,
        appId: APP_ID,
        appSecret: SECRET_APP_SECRET,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(res.accessToken).toBe("EAAG_refreshed_new_token_11111");
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain(`https://graph.facebook.com/${DEFAULT_GRAPH_VERSION}/oauth/access_token`);
    });

    it("should support custom configurable Graph API version (e.g. v22.0)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "EAAG_refreshed_new_token_v22",
          expires_in: 5184000,
        }),
      });

      await refreshLongLivedToken({
        currentToken: SECRET_TOKEN,
        appId: APP_ID,
        appSecret: SECRET_APP_SECRET,
        apiVersion: "v22.0",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("https://graph.facebook.com/v22.0/oauth/access_token");
    });
  });

  describe("Atomic .env File Update", () => {
    it("should update .env atomically via temporary write and rename", () => {
      const initialEnv = `# Meta Configuration
APP_ENV=development
PORT=3000
INSTAGRAM_ACCOUNT_ID=17841400000000000
INSTAGRAM_ACCESS_TOKEN=old_sample_token_to_replace
META_APP_ID=12345
`;

      const filesWritten: Record<string, string> = {};
      let renameSource = "";
      let renameTarget = "";

      const mockFs = {
        existsSync: () => true,
        readFileSync: () => initialEnv,
        writeFileSync: (filePath: string, content: string) => {
          filesWritten[filePath] = content;
        },
        renameSync: (oldPath: string, newPath: string) => {
          renameSource = oldPath;
          renameTarget = newPath;
          filesWritten[newPath] = filesWritten[oldPath];
        },
        unlinkSync: vi.fn(),
      };

      updateEnvFileToken(".env", "new_freshly_generated_token_xyz", mockFs as any);

      // Verify that write was to a temp file, followed by atomic renameSync
      expect(renameSource).toContain(".env.tmp.");
      expect(renameTarget).toBe(".env");
      expect(filesWritten[".env"]).toContain("INSTAGRAM_ACCESS_TOKEN=new_freshly_generated_token_xyz");
      expect(filesWritten[".env"]).toContain("# Meta Configuration");
      expect(filesWritten[".env"]).not.toContain("old_sample_token_to_replace");
    });
  });

  describe("Zero-Leak Audits (Stdout, Stderr, and Logs)", () => {
    it("should assert that token, app secret, and full URL never appear in stdout, stderr, or logs on forced network error", async () => {
      const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const processStderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const mockFetch = vi.fn().mockRejectedValue(
        new Error(`getaddrinfo ENOTFOUND graph.facebook.com with query fb_exchange_token=${SECRET_TOKEN}&client_secret=${SECRET_APP_SECRET}`)
      );

      try {
        await refreshLongLivedToken({
          currentToken: SECRET_TOKEN,
          appId: APP_ID,
          appSecret: SECRET_APP_SECRET,
          fetchFn: mockFetch as unknown as typeof fetch,
        });
        expect.unreachable("Should have thrown network error");
      } catch (err) {
        expect(err).toBeInstanceOf(BaseError);
        // Error message must not contain secret token or app secret
        expect((err as Error).message).not.toContain(SECRET_TOKEN);
        expect((err as Error).message).not.toContain(SECRET_APP_SECRET);
      }

      // Check all console and stderr outputs
      for (const call of stdoutSpy.mock.calls) {
        expect(call.join(" ")).not.toContain(SECRET_TOKEN);
        expect(call.join(" ")).not.toContain(SECRET_APP_SECRET);
      }
      for (const call of stderrSpy.mock.calls) {
        expect(call.join(" ")).not.toContain(SECRET_TOKEN);
        expect(call.join(" ")).not.toContain(SECRET_APP_SECRET);
      }
      for (const call of processStderrSpy.mock.calls) {
        const text = String(call[0]);
        expect(text).not.toContain(SECRET_TOKEN);
        expect(text).not.toContain(SECRET_APP_SECRET);
      }
    });

    it("should assert that token, app secret, and full URL never appear in stdout, stderr, or logs on 4xx Meta error", async () => {
      const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const processStderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: "Invalid verification code or token has expired.",
            type: "OAuthException",
            code: 190,
            fbtrace_id: "FBT_TEST_TRACE",
          },
        }),
      });

      try {
        await refreshLongLivedToken({
          currentToken: SECRET_TOKEN,
          appId: APP_ID,
          appSecret: SECRET_APP_SECRET,
          fetchFn: mockFetch as unknown as typeof fetch,
        });
        expect.unreachable("Should have thrown AuthenticationError");
      } catch (err) {
        expect(err).toBeInstanceOf(AuthenticationError);
        expect((err as Error).message).not.toContain(SECRET_TOKEN);
        expect((err as Error).message).not.toContain(SECRET_APP_SECRET);
      }

      // Check all outputs
      for (const call of stdoutSpy.mock.calls) {
        expect(call.join(" ")).not.toContain(SECRET_TOKEN);
        expect(call.join(" ")).not.toContain(SECRET_APP_SECRET);
      }
      for (const call of stderrSpy.mock.calls) {
        expect(call.join(" ")).not.toContain(SECRET_TOKEN);
        expect(call.join(" ")).not.toContain(SECRET_APP_SECRET);
      }
      for (const call of processStderrSpy.mock.calls) {
        const text = String(call[0]);
        expect(text).not.toContain(SECRET_TOKEN);
        expect(text).not.toContain(SECRET_APP_SECRET);
      }
    });

    it("should assert that token, app secret, and full URL never appear in stdout, stderr, or logs on successful refresh", async () => {
      const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const processStderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const NEW_TOKEN = "EAAG_brand_new_secret_refreshed_token_2026";
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: NEW_TOKEN,
          expires_in: 5184000,
        }),
      });

      const res = await refreshLongLivedToken({
        currentToken: SECRET_TOKEN,
        appId: APP_ID,
        appSecret: SECRET_APP_SECRET,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(res.accessToken).toBe(NEW_TOKEN);

      for (const call of stdoutSpy.mock.calls) {
        expect(call.join(" ")).not.toContain(SECRET_TOKEN);
        expect(call.join(" ")).not.toContain(NEW_TOKEN);
        expect(call.join(" ")).not.toContain(SECRET_APP_SECRET);
      }
      for (const call of stderrSpy.mock.calls) {
        expect(call.join(" ")).not.toContain(SECRET_TOKEN);
        expect(call.join(" ")).not.toContain(NEW_TOKEN);
        expect(call.join(" ")).not.toContain(SECRET_APP_SECRET);
      }
      for (const call of processStderrSpy.mock.calls) {
        const text = String(call[0]);
        expect(text).not.toContain(SECRET_TOKEN);
        expect(text).not.toContain(NEW_TOKEN);
        expect(text).not.toContain(SECRET_APP_SECRET);
      }
    });
  });
});
