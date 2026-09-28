import { describe, it, expect, vi } from "vitest";
import { FacebookLoginProvider } from "./facebook-login.js";
import { MockInstagramGraphProvider, FIXTURES } from "./mock-provider.js";
import { AuthenticationError, RateLimitError } from "../errors/index.js";

describe("Provider Layer Abstraction (Rule 3 & Rule 7)", () => {
  describe("FacebookLoginProvider", () => {
    it("should construct request with Authorization header and correct endpoint", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ id: "17841400000000000", username: "test_user" }),
      });

      const provider = new FacebookLoginProvider({
        accessToken: "EAAG_valid_test_token_12345",
        accountId: "17841400000000000",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const data = await provider.get<{ id: string; username: string }>("me", {
        params: { fields: "id,username" },
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe("https://graph.facebook.com/v21.0/me?fields=id%2Cusername");
      expect(calledInit.method).toBe("GET");
      expect(calledInit.headers.Authorization).toBe("Bearer EAAG_valid_test_token_12345");
      expect(data.username).toBe("test_user");
    });

    it("should map HTTP 401 Meta error code 190 to AuthenticationError", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: {
            message: "Error validating access token: Session has expired.",
            type: "OAuthException",
            code: 190,
            error_subcode: 463,
          },
        }),
      });

      const provider = new FacebookLoginProvider({
        accessToken: "expired_token_123",
        accountId: "17841400000000000",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      await expect(provider.get("me")).rejects.toThrowError(AuthenticationError);
    });

    it("should map HTTP 429 Meta error code 32 to RateLimitError", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: {
            message: "(#32) Page request limit reached",
            type: "OAuthException",
            code: 32,
          },
        }),
      });

      const provider = new FacebookLoginProvider({
        accessToken: "rate_limited_token",
        accountId: "17841400000000000",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      await expect(provider.get("me")).rejects.toThrowError(RateLimitError);
    });

    it("should handle dynamic access token function for token rotation", async () => {
      let currentToken = "token_v1";
      const tokenProvider = vi.fn(async () => currentToken);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ ok: true }),
      });

      const provider = new FacebookLoginProvider({
        accessToken: tokenProvider,
        accountId: "17841400000000000",
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      await provider.get("me");
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer token_v1");

      currentToken = "token_v2";
      await provider.get("me");
      expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe("Bearer token_v2");
    });
  });

  describe("MockInstagramGraphProvider (Hand-written fixtures)", () => {
    it("should return official fixture shapes for profile and media requests", async () => {
      const mock = new MockInstagramGraphProvider();

      const profile = await mock.get("17841400000000000");
      expect(profile).toEqual(FIXTURES.profile);

      const media = await mock.get("17841400000000000/media");
      expect(media).toEqual(FIXTURES.mediaList);

      const comments = await mock.get("17900000000000001/comments");
      expect(comments).toEqual(FIXTURES.comments);

      expect(mock.callHistory).toHaveLength(3);
    });

    it("should allow custom mock overrides", async () => {
      const mock = new MockInstagramGraphProvider();
      mock.setMockResponse("custom/path", { custom: "result" });

      const res = await mock.get("custom/path");
      expect(res).toEqual({ custom: "result" });
    });
  });
});
