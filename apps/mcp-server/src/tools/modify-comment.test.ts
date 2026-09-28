import { describe, it, expect, beforeEach } from "vitest";
import {
  previewModifyCommentTool,
  executeModifyCommentTool,
} from "./modify-comment.js";
import { MockInstagramGraphProvider } from "../providers/mock-provider.js";
import { confirmationStore, ConfirmationError } from "../security/confirmation.js";

describe("Feature 9: Hide and Delete Comment with Two-Step Confirmation", () => {
  beforeEach(() => {
    confirmationStore.clear();
  });

  it("should preview hiding a comment and execute it with valid confirmation", async () => {
    const mockProvider = new MockInstagramGraphProvider();

    const preview = await previewModifyCommentTool.execute({
      comment_id: "17988888888888881",
      action: "hide",
    });

    expect(preview.confirmation_id).toBeDefined();
    expect(preview.action).toBe("HIDE_COMMENT");
    expect(preview.preview_summary).toContain("Hide comment");

    const result = await executeModifyCommentTool.execute(
      { confirmation_id: preview.confirmation_id },
      mockProvider
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("hide");
    expect(result.comment_id).toBe("17988888888888881");

    const call = mockProvider.callHistory[0];
    expect(call.method).toBe("POST");
    expect(call.endpoint).toBe("17988888888888881");
    expect(call.options?.params?.hide).toBe(true);
  });

  it("should preview unhiding a comment and execute it", async () => {
    const mockProvider = new MockInstagramGraphProvider();

    const preview = await previewModifyCommentTool.execute({
      comment_id: "17988888888888882",
      action: "unhide",
    });

    expect(preview.action).toBe("UNHIDE_COMMENT");

    const result = await executeModifyCommentTool.execute(
      { confirmation_id: preview.confirmation_id },
      mockProvider
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("unhide");

    const call = mockProvider.callHistory[0];
    expect(call.options?.params?.hide).toBe(false);
  });

  it("should preview deleting a comment and execute DELETE HTTP request", async () => {
    const mockProvider = new MockInstagramGraphProvider();

    const preview = await previewModifyCommentTool.execute({
      comment_id: "17988888888888883",
      action: "delete",
    });

    expect(preview.action).toBe("DELETE_COMMENT");
    expect(preview.preview_summary).toContain("PERMANENTLY DELETE");

    const result = await executeModifyCommentTool.execute(
      { confirmation_id: preview.confirmation_id },
      mockProvider
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("delete");

    const call = mockProvider.callHistory[0];
    expect(call.method).toBe("DELETE");
    expect(call.endpoint).toBe("17988888888888883");

    // Token must be burned
    await expect(
      executeModifyCommentTool.execute(
        { confirmation_id: preview.confirmation_id },
        mockProvider
      )
    ).rejects.toThrowError(ConfirmationError);
  });

  it("should reject execution of invalid confirmation IDs", async () => {
    const mockProvider = new MockInstagramGraphProvider();

    await expect(
      executeModifyCommentTool.execute(
        { confirmation_id: "11111111-1111-1111-1111-111111111111" },
        mockProvider
      )
    ).rejects.toThrowError(ConfirmationError);
  });
});
