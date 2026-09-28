import { describe, it, expect, beforeEach } from "vitest";
import { validateEnv, getConfig, resetConfigCache } from "./env.js";

describe("Environment Configuration (Feature 19 - Zod Validation)", () => {
  beforeEach(() => {
    resetConfigCache();
  });

  describe("Lite Mode Validation", () => {
    it("should successfully parse a valid Lite mode configuration", () => {
      const validEnv = {
        RUN_MODE: "lite",
        INSTAGRAM_ACCOUNT_ID: "17841400000000000",
        INSTAGRAM_ACCESS_TOKEN: "EAAG_sample_valid_long_token_here_12345",
        PORT: "3000",
        LOG_LEVEL: "info",
        APP_ENV: "development",
      };

      const config = validateEnv(validEnv);
      expect(config.RUN_MODE).toBe("lite");
      expect(config.INSTAGRAM_ACCOUNT_ID).toBe("17841400000000000");
      expect(config.INSTAGRAM_ACCESS_TOKEN).toBe("EAAG_sample_valid_long_token_here_12345");
      expect(config.PORT).toBe(3000);
      expect(config.LOG_LEVEL).toBe("info");
      expect(config.APP_ENV).toBe("development");
    });

    it("should apply default values when optional fields are omitted in Lite mode", () => {
      const minimalEnv = {
        INSTAGRAM_ACCOUNT_ID: "17841400000000000",
        INSTAGRAM_ACCESS_TOKEN: "EAAG_sample_valid_long_token_here_12345",
      };

      const config = validateEnv(minimalEnv);
      expect(config.RUN_MODE).toBe("lite");
      expect(config.PORT).toBe(3000);
      expect(config.LOG_LEVEL).toBe("info");
      expect(config.APP_ENV).toBe("development");
      expect(config.WORKER_URL).toBe("http://localhost:8081");
    });

    it("should fail when INSTAGRAM_ACCOUNT_ID is missing in Lite mode", () => {
      const invalidEnv = {
        RUN_MODE: "lite",
        INSTAGRAM_ACCESS_TOKEN: "EAAG_sample_valid_long_token_here_12345",
      };

      expect(() => validateEnv(invalidEnv)).toThrowError(
        /INSTAGRAM_ACCOUNT_ID is required when RUN_MODE is 'lite'/
      );
    });

    it("should fail when INSTAGRAM_ACCOUNT_ID is not a numeric string", () => {
      const invalidEnv = {
        RUN_MODE: "lite",
        INSTAGRAM_ACCOUNT_ID: "invalid-alphanumeric-id",
        INSTAGRAM_ACCESS_TOKEN: "EAAG_sample_valid_long_token_here_12345",
      };

      expect(() => validateEnv(invalidEnv)).toThrowError(
        /Instagram Account ID must be a numeric string/
      );
    });

    it("should fail when INSTAGRAM_ACCESS_TOKEN is missing in Lite mode", () => {
      const invalidEnv = {
        RUN_MODE: "lite",
        INSTAGRAM_ACCOUNT_ID: "17841400000000000",
      };

      expect(() => validateEnv(invalidEnv)).toThrowError(
        /INSTAGRAM_ACCESS_TOKEN is required when RUN_MODE is 'lite'/
      );
    });

    it("should fail when INSTAGRAM_ACCESS_TOKEN is too short", () => {
      const invalidEnv = {
        RUN_MODE: "lite",
        INSTAGRAM_ACCOUNT_ID: "17841400000000000",
        INSTAGRAM_ACCESS_TOKEN: "short",
      };

      expect(() => validateEnv(invalidEnv)).toThrowError(
        /Access token must be at least 10 characters/
      );
    });
  });

  describe("Full Mode Validation", () => {
    it("should validate Full mode without requiring direct tokens in env", () => {
      const fullEnv = {
        RUN_MODE: "full",
        WORKER_URL: "http://core-worker:8081",
        DATABASE_URL: "postgresql://postgres:postgres@db:5432/mcb_instagram",
      };

      const config = validateEnv(fullEnv);
      expect(config.RUN_MODE).toBe("full");
      expect(config.WORKER_URL).toBe("http://core-worker:8081");
      expect(config.DATABASE_URL).toBe("postgresql://postgres:postgres@db:5432/mcb_instagram");
    });

    it("should fail when WORKER_URL is not a valid URL in Full mode", () => {
      const invalidEnv = {
        RUN_MODE: "full",
        WORKER_URL: "not-a-valid-url",
      };

      expect(() => validateEnv(invalidEnv)).toThrowError(/Worker URL must be a valid URL/);
    });
  });

  describe("Common Field Validation", () => {
    it("should fail when PORT is out of range", () => {
      const invalidEnv = {
        RUN_MODE: "full",
        PORT: "70000",
      };

      expect(() => validateEnv(invalidEnv)).toThrowError(/PORT/);
    });

    it("should fail when LOG_LEVEL is invalid", () => {
      const invalidEnv = {
        RUN_MODE: "full",
        LOG_LEVEL: "verbose",
      };

      expect(() => validateEnv(invalidEnv)).toThrowError(/LOG_LEVEL/);
    });

    it("should format errors cleanly without printing secret token values", () => {
      const secretToken = "SUPER_SECRET_TOKEN_VALUE_NEVER_PRINT";
      const invalidEnv = {
        RUN_MODE: "lite",
        INSTAGRAM_ACCESS_TOKEN: secretToken,
        PORT: "-1",
        // missing INSTAGRAM_ACCOUNT_ID
      };

      try {
        validateEnv(invalidEnv);
        expect.unreachable("should have thrown validation error");
      } catch (err: unknown) {
        const message = (err as Error).message;
        expect(message).toContain("Environment configuration validation failed");
        expect(message).toContain("INSTAGRAM_ACCOUNT_ID");
        expect(message).not.toContain(secretToken);
      }
    });
  });

  describe("Config Caching", () => {
    it("should return identical cached config on repeated calls", () => {
      const env = {
        RUN_MODE: "full",
        PORT: "4000",
      };

      const cfg1 = getConfig(env);
      const cfg2 = getConfig(env);
      expect(cfg1).toEqual(cfg2);
    });
  });
});
