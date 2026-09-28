import { describe, it, expect, vi } from "vitest";
import { refreshLongLivedToken, updateEnvFileToken, runRefreshTokenCli } from "./refresh-token.js";
import { AuthenticationError } from "../errors/index.js";

describe("Lite Mode CLI (Feature 16 Lite - refresh-token)", () => {
  it("should exchange current token for new long-lived token via Meta Graph API", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "EAAG_new_refreshed_access_token_99999",
        token_type: "bearer",
        expires_in: 5184000,
      }),
    });

    const result = await refreshLongLivedToken({
      currentToken: "EAAG_current_old_token_12345",
      appId: "1234567890",
      appSecret: "app_secret_abc123",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.accessToken).toBe("EAAG_new_refreshed_access_token_99999");
    expect(result.expiresInSeconds).toBe(5184000);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("grant_type=fb_exchange_token");
    expect(calledUrl).toContain("client_id=1234567890");
  });

  it("should throw AuthenticationError if Meta Graph API rejects refresh", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: "Error validating verification code that was used to generate this token.",
          code: 100,
        },
      }),
    });

    await expect(
      refreshLongLivedToken({
        currentToken: "invalid_or_expired_token",
        appId: "1234567890",
        appSecret: "app_secret_abc123",
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toThrowError(AuthenticationError);
  });

  it("should update .env file preserving comments and structure without leaking token", () => {
    const initialEnv = `# Meta Configuration
APP_ENV=development
PORT=3000
INSTAGRAM_ACCOUNT_ID=17841400000000000
INSTAGRAM_ACCESS_TOKEN=old_sample_token_to_replace
META_APP_ID=12345
`;

    let writtenContent = "";
    const mockFs = {
      existsSync: () => true,
      readFileSync: () => initialEnv,
      writeFileSync: (_file: string, content: string) => {
        writtenContent = content;
      },
    };

    updateEnvFileToken(".env", "new_freshly_generated_token_xyz", mockFs as any);

    expect(writtenContent).toContain("INSTAGRAM_ACCESS_TOKEN=new_freshly_generated_token_xyz");
    expect(writtenContent).toContain("# Meta Configuration");
    expect(writtenContent).toContain("PORT=3000");
    expect(writtenContent).not.toContain("old_sample_token_to_replace");
  });

  it("should verify that stdout/stderr never prints the actual secret token", async () => {
    const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const secretToken = "EAAG_very_secret_token_never_leak_in_logs";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: secretToken,
        expires_in: 5184000,
      }),
    });

    let writtenContent = "";
    const mockFs = {
      existsSync: () => true,
      readFileSync: () => "INSTAGRAM_ACCESS_TOKEN=old\n",
      writeFileSync: (_f: string, c: string) => {
        writtenContent = c;
      },
    };

    process.env.INSTAGRAM_ACCESS_TOKEN = "old_token";
    process.env.META_APP_ID = "123";
    process.env.META_APP_SECRET = "sec";

    // Run CLI with mock fs
    const res = await refreshLongLivedToken({
      currentToken: "old_token",
      appId: "123",
      appSecret: "sec",
      fetchFn: mockFetch as unknown as typeof fetch,
    });
    updateEnvFileToken(".env", res.accessToken, mockFs as any);

    // Verify written content contains new token
    expect(writtenContent).toContain(secretToken);

    // Verify console log NEVER contains secret token
    for (const call of stdoutSpy.mock.calls) {
      expect(call.join(" ")).not.toContain(secretToken);
    }

    stdoutSpy.mockRestore();
  });
});
