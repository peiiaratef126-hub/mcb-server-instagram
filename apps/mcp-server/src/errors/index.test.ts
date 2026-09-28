import { describe, it, expect } from "vitest";
import {
  mapMetaErrorToDomainError,
  AuthenticationError,
  RateLimitError,
  InstagramApiError,
} from "./index.js";

describe("Error Hierarchy & Meta Error Mapping (Feature 17)", () => {
  it("should map code 190 to AuthenticationError", () => {
    const metaError = {
      error: {
        message: "Error validating access token: Session has expired.",
        type: "OAuthException",
        code: 190,
        error_subcode: 463,
        fbtrace_id: "A1B2C3D4E5",
      },
    };

    const err = mapMetaErrorToDomainError(metaError, 401);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.code).toBe(190);
    expect(err.subcode).toBe(463);
    expect(err.fbtrace_id).toBe("A1B2C3D4E5");
    expect(err.status).toBe(401);
    expect(err.guidance).toContain("Run 'refresh-token'");
  });

  it("should map code 32 to RateLimitError", () => {
    const metaError = {
      error: {
        message: "(#32) Page request limit reached",
        type: "OAuthException",
        code: 32,
      },
    };

    const err = mapMetaErrorToDomainError(metaError, 429);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.code).toBe(32);
    expect(err.status).toBe(429);
    expect(err.guidance).toContain("rate limit reached");
  });

  it("should map code 100 with invalid parameter guidance", () => {
    const metaError = {
      error: {
        message: "(#100) Tried accessing nonexisting field (followers_count) on node type (User)",
        type: "OAuthException",
        code: 100,
      },
    };

    const err = mapMetaErrorToDomainError(metaError, 400);
    expect(err).toBeInstanceOf(InstagramApiError);
    expect(err.code).toBe(100);
    expect(err.guidance).toContain("Invalid parameter");
  });

  it("should map code 200 with permission guidance", () => {
    const metaError = {
      error: {
        message: "(#200) Requires instagram_manage_comments permission to manage the object",
        type: "OAuthException",
        code: 200,
      },
    };

    const err = mapMetaErrorToDomainError(metaError, 403);
    expect(err).toBeInstanceOf(InstagramApiError);
    expect(err.code).toBe(200);
    expect(err.guidance).toContain("Permission denied");
  });
});
