import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConfirmationStore, ConfirmationError, computePayloadHash } from "./confirmation.js";

describe("Two-Step Confirmation Engine (Security Rule 4)", () => {
  let store: ConfirmationStore;

  beforeEach(() => {
    store = new ConfirmationStore();
  });

  it("should create a valid confirmation with default 5-minute TTL", () => {
    const confirmation = store.create({
      toolName: "execute_reply_comment",
      action: "REPLY_COMMENT",
      targetId: "17988888888888881",
      payload: { message: "Thanks for the feedback!" },
      previewSummary: "Reply 'Thanks for the feedback!' to comment 17988888888888881",
    });

    expect(confirmation.id).toBeDefined();
    expect(confirmation.toolName).toBe("execute_reply_comment");
    expect(confirmation.action).toBe("REPLY_COMMENT");
    expect(confirmation.targetId).toBe("17988888888888881");
    expect(confirmation.payload).toEqual({ message: "Thanks for the feedback!" });
    expect(confirmation.payloadHash).toBe(computePayloadHash({ message: "Thanks for the feedback!" }));
    expect(confirmation.expiresAt - confirmation.createdAt).toBe(5 * 60 * 1000);
    expect(store.activeCount).toBe(1);
  });

  it("should allow consumption of a valid confirmation exactly once (burn-after-reading / replay after use rejection)", () => {
    const confirmation = store.create({
      toolName: "execute_modify_comment",
      action: "DELETE_COMMENT",
      targetId: "17988888888888882",
      payload: {},
      previewSummary: "Permanently delete comment 17988888888888882",
    });

    const consumed = store.consume(confirmation.id, "execute_modify_comment");
    expect(consumed.id).toBe(confirmation.id);

    // Replay after use: second consumption must fail immediately
    expect(() => store.consume(confirmation.id, "execute_modify_comment")).toThrowError(
      ConfirmationError
    );
    expect(() => store.consume(confirmation.id, "execute_modify_comment")).toThrowError(
      /Invalid or expired confirmation_id/
    );
  });

  it("should enforce cross-tool ID rejection when confirmation is presented to wrong tool", () => {
    // Confirmation created for execute_reply_comment
    const confirmation = store.create({
      toolName: "execute_reply_comment",
      action: "REPLY_COMMENT",
      targetId: "17988888888888883",
      payload: { message: "Hello" },
      previewSummary: "Reply preview",
    });

    // Attempt to consume with execute_modify_comment
    expect(() => store.consume(confirmation.id, "execute_modify_comment")).toThrowError(
      ConfirmationError
    );
    expect(() => store.consume(confirmation.id, "execute_modify_comment")).toThrowError(
      /Confirmation token mismatch.*not valid for tool 'execute_modify_comment'/
    );
  });

  it("should reject consumption of expired confirmations using fake timers", () => {
    vi.useFakeTimers();

    const confirmation = store.create({
      toolName: "execute_reply_comment",
      action: "REPLY_COMMENT",
      targetId: "17988888888888884",
      payload: { message: "Late reply" },
      previewSummary: "Preview",
      ttlMs: 1000, // 1 second TTL
    });

    // Advance time beyond expiry
    vi.advanceTimersByTime(2000);

    expect(() => store.consume(confirmation.id, "execute_reply_comment")).toThrowError(
      ConfirmationError
    );
    expect(() => store.consume(confirmation.id, "execute_reply_comment")).toThrowError(
      /expired/
    );

    vi.useRealTimers();
  });

  it("should reject malformed confirmation IDs with generic format error", () => {
    const malformedIds = [
      "",
      "not-a-uuid",
      "12345",
      "../etc/passwd",
      "null",
      "undefined",
      "g0000000-0000-0000-0000-000000000000", // invalid hex
    ];

    for (const badId of malformedIds) {
      expect(() => store.consume(badId, "execute_reply_comment")).toThrowError(
        /Invalid confirmation_id format/
      );
    }
  });

  it("should verify payload integrity via payload hash", () => {
    const confirmation = store.create({
      toolName: "execute_reply_comment",
      action: "REPLY_COMMENT",
      targetId: "17988888888888885",
      payload: { message: "Original payload" },
      previewSummary: "Preview",
    });

    // Tamper with payload in memory
    confirmation.payload.message = "Tampered payload";

    expect(() => store.consume(confirmation.id, "execute_reply_comment")).toThrowError(
      /integrity verification failed/
    );
  });
});
