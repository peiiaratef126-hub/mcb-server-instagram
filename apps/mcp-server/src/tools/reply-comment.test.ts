import { describe, it, expect, beforeEach } from "vitest";
import {
  previewReplyCommentTool,
  executeReplyCommentTool,
} from "./reply-comment.js";
import { MockInstagramGraphProvider } from "../providers/mock-provider.js";
import { confirmationStore, ConfirmationError } from "../security/confirmation.js";

describe("Feature 8: Reply to Comment with Two-Step Confirmation", () => {
  beforeEach(() => {
    confirmationStore.clear();
  });

  it("should generate a 5-minute confirmation in preview step and not make API calls", async () => {
    const preview = await previewReplyCommentTool.execute({
      comment_id: "17988888888888881",
      message: "Thank you for supporting our project!",
    });

    expect(preview.confirmation_id).toBeDefined();
    expect(preview.action).toBe("REPLY_COMMENT");
    expect(preview.target_id).toBe("17988888888888881");
    expect(preview.preview_summary).toContain("Thank you for supporting our project!");
    expect(confirmationStore.activeCount).toBe(1);
  });

  it("should successfully execute reply using valid confirmation ID and burn it", async () => {
    const mockProvider = new MockInstagramGraphProvider();

    const preview = await previewReplyCommentTool.execute({
      comment_id: "17988888888888881",
      message: "Here is your response.",
    });

    const result = await executeReplyCommentTool.execute(
      { confirmation_id: preview.confirmation_id },
      mockProvider
    );

    expect(result.success).toBe(true);
    expect(result.comment_id).toBe("17988888888888881");
    expect(result.reply_id).toBe("17999999999999999");

    const call = mockProvider.callHistory[0];
    expect(call.method).toBe("POST");
    expect(call.endpoint).toBe("17988888888888881/replies");
    expect(call.body).toEqual({ message: "Here is your response." });

    // Ensure confirmation was burned
    await expect(
      executeReplyCommentTool.execute(
        { confirmation_id: preview.confirmation_id },
        mockProvider
      )
    ).rejects.toThrowError(ConfirmationError);
  });

  it("should refuse execution without a valid confirmation ID", async () => {
    const mockProvider = new MockInstagramGraphProvider();

    await expect(
      executeReplyCommentTool.execute(
        { confirmation_id: "00000000-0000-0000-0000-000000000000" },
        mockProvider
      )
    ).rejects.toThrowError(ConfirmationError);
  });
});
