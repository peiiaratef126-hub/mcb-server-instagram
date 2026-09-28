import { describe, it, expect } from "vitest";
import {
  listConversationsTool,
  getConversationMessagesTool,
  previewSendDmTool,
  executeSendDmTool,
} from "./direct-messages.js";
import { executeReplyCommentTool } from "./reply-comment.js";
import { MockInstagramGraphProvider } from "../providers/mock-provider.js";
import { ConfirmationError } from "../security/confirmation.js";

describe("Feature 14: Direct Messages Tools", () => {
  it("list_conversations should return conversations with security warning", async () => {
    const provider = new MockInstagramGraphProvider();
    const result = await listConversationsTool.execute({ limit: 10 }, provider);

    expect(result.data).toBeDefined();
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0].id).toBe("t_17841411111111111");
    expect(result.security_warning).toContain("CRITICAL");
  });

  it("get_conversation_messages should return messages with security warning", async () => {
    const provider = new MockInstagramGraphProvider();
    const result = await getConversationMessagesTool.execute(
      { conversation_id: "t_17841411111111111", limit: 10 },
      provider
    );

    expect(result.data).toBeDefined();
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0].message).toBe("Hello! Do you ship internationally?");
    expect(result.security_warning).toContain("CRITICAL");
  });

  it("preview_send_dm and execute_send_dm should complete two-step confirmation flow", async () => {
    const provider = new MockInstagramGraphProvider();

    // Step 1: Preview
    const preview = await previewSendDmTool.execute({
      recipient_id: "17841411111111111",
      message: "Yes! We offer worldwide shipping via DHL.",
    });

    expect(preview.confirmation_id).toBeDefined();
    expect(preview.action).toBe("SEND_DIRECT_MESSAGE");
    expect(preview.preview_summary).toContain("worldwide shipping");
    expect(preview.instructions).toContain("execute_send_dm");

    // Step 2: Execute
    const execution = await executeSendDmTool.execute(
      { confirmation_id: preview.confirmation_id },
      provider
    );

    expect(execution.success).toBe(true);
    expect(execution.recipient_id).toBe("17841411111111111");

    // Verify token was burned: replay attempt must fail
    await expect(
      executeSendDmTool.execute({ confirmation_id: preview.confirmation_id }, provider)
    ).rejects.toThrow(ConfirmationError);
  });

  it("cross-tool execution should be rejected if DM confirmation is sent to execute_reply_comment", async () => {
    const provider = new MockInstagramGraphProvider();

    const preview = await previewSendDmTool.execute({
      recipient_id: "17841411111111111",
      message: "Testing cross tool protection",
    });

    // Attempt to redeem DM confirmation in comment reply executor
    await expect(
      executeReplyCommentTool.execute({ confirmation_id: preview.confirmation_id }, provider)
    ).rejects.toThrow(ConfirmationError);
  });
});
