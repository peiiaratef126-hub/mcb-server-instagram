import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger, scrubSecrets } from "./logger.js";

describe("Logger & Secret Scrubbing (Feature 17)", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  describe("scrubSecrets", () => {
    it("should redact Meta EAAG tokens from strings", () => {
      const raw = "Request failed for EAAGabcdef1234567890_xyz";
      const scrubbed = scrubSecrets(raw);
      expect(scrubbed).not.toContain("EAAGabcdef1234567890_xyz");
      expect(scrubbed).toContain("[REDACTED]");
    });

    it("should redact access_token query parameters", () => {
      const url = "https://graph.facebook.com/v21.0/me?access_token=secret_token_val_123&fields=id";
      const scrubbed = scrubSecrets(url) as string;
      expect(scrubbed).not.toContain("secret_token_val_123");
      expect(scrubbed).toContain("access_token=[REDACTED]");
    });

    it("should recursively redact sensitive keys in nested objects", () => {
      const payload = {
        user: "test_user",
        meta: {
          accessToken: "EAAG_super_secret_value",
          appSecret: "app_secret_abc123",
          normalField: "public_value",
        },
      };

      const scrubbed = scrubSecrets(payload) as any;
      expect(scrubbed.meta.accessToken).toBe("[REDACTED]");
      expect(scrubbed.meta.appSecret).toBe("[REDACTED]");
      expect(scrubbed.meta.normalField).toBe("public_value");
    });
  });

  describe("Logger stderr routing", () => {
    it("should write logs to stderr and not touch stdout", () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const testLogger = new Logger("info");

      testLogger.info("Server started successfully", { port: 3000 });

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stdoutSpy).not.toHaveBeenCalled();

      const loggedOutput = JSON.parse(stderrSpy.mock.calls[0][0] as string);
      expect(loggedOutput.level).toBe("INFO");
      expect(loggedOutput.message).toBe("Server started successfully");
      expect(loggedOutput.meta.port).toBe(3000);

      stdoutSpy.mockRestore();
    });

    it("should filter logs below active log level", () => {
      const testLogger = new Logger("warn");
      testLogger.debug("Debug details");
      testLogger.info("Informational message");
      expect(stderrSpy).not.toHaveBeenCalled();

      testLogger.warn("Warning alert");
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });
  });
});
