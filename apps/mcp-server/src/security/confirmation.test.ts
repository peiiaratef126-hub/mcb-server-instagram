import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConfirmationStore, ConfirmationError } from "./confirmation.js";

describe("Two-Step Confirmation Engine (Security Rule 4)", () => {
  let store: ConfirmationStore;

  beforeEach(() => {
    store = new ConfirmationStore();
  });

  it("should create a valid confirmation with default 5-minute TTL", () => {
    const confirmation = store.create(
      "REPLY_COMMENT",
      "17988888888888881",
      { message: "Thanks for the feedback!" },
      "Reply 'Thanks for the feedback!' to comment 17988888888888881"
    );

    expect(confirmation.id).toBeDefined();
    expect(confirmation.action).toBe("REPLY_COMMENT");
    expect(confirmation.targetId).toBe("17988888888888881");
    expect(confirmation.payload).toEqual({ message: "Thanks for the feedback!" });
    expect(confirmation.expiresAt - confirmation.createdAt).toBe(5 * 60 * 1000);
    expect(store.activeCount).toBe(1);
  });

  it("should allow consumption of a valid confirmation exactly once (burn-after-reading)", () => {
    const confirmation = store.create(
      "DELETE_COMMENT",
      "17988888888888882",
      {},
      "Permanently delete comment 17988888888888882"
    );

    const consumed = store.consume(confirmation.id, "DELETE_COMMENT");
    expect(consumed.id).toBe(confirmation.id);

    // Second consumption must fail
    expect(() => store.consume(confirmation.id, "DELETE_COMMENT")).toThrowError(
      ConfirmationError
    );
    expect(() => store.consume(confirmation.id, "DELETE_COMMENT")).toThrowError(
      /Invalid or expired confirmation_id/
    );
  });

  it("should reject consumption if action does not match expected action", () => {
    const confirmation = store.create(
      "HIDE_COMMENT",
      "17988888888888883",
      {},
      "Hide comment 17988888888888883"
    );

    expect(() => store.consume(confirmation.id, "DELETE_COMMENT")).toThrowError(
      /Confirmation action mismatch/
    );
  });

  it("should reject consumption of expired confirmations", () => {
    vi.useFakeTimers();

    const confirmation = store.create(
      "REPLY_COMMENT",
      "17988888888888884",
      { message: "Late reply" },
      "Preview",
      1000 // 1 second TTL
    );

    // Advance time by 2 seconds
    vi.advanceTimersByTime(2000);

    expect(() => store.consume(confirmation.id, "REPLY_COMMENT")).toThrowError(
      /has expired|Invalid or expired/
    );

    vi.useRealTimers();
  });
});
