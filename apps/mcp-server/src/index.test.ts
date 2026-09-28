import { describe, it, expect } from "vitest";
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { MockInstagramGraphProvider } from "./providers/mock-provider.js";

describe("MCP Server Integration (Phase 1 & Phase 2)", () => {
  it("should initialize McpServer with correct metadata", () => {
    const mockProvider = new MockInstagramGraphProvider();
    const server = createMcpServer(mockProvider);

    expect(server).toBeDefined();
    expect(SERVER_NAME).toBe("mcb-server-instagram");
    expect(SERVER_VERSION).toBe("0.3.0");
  });

  it("should register all read and write tools with appropriate MCP tool annotations", () => {
    const mockProvider = new MockInstagramGraphProvider();
    const server = createMcpServer(mockProvider) as any;

    const registered = server._registeredTools;
    expect(Object.keys(registered)).toEqual([
      "get_profile_info",
      "get_recent_posts",
      "get_post_details",
      "list_comments",
      "get_account_insights",
      "get_post_insights",
      "preview_reply_comment",
      "execute_reply_comment",
      "preview_modify_comment",
      "execute_modify_comment",
      "preview_publish_image",
      "execute_publish_image",
      "preview_publish_video",
      "execute_publish_video",
      "preview_publish_carousel",
      "execute_publish_carousel",
      "preview_schedule_post",
      "execute_schedule_post",
      "get_user_tags",
      "get_mentions",
      "list_conversations",
      "get_conversation_messages",
      "preview_send_dm",
      "execute_send_dm",
    ]);

    // Read tools
    expect(registered.get_profile_info.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(registered.get_recent_posts.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(registered.get_user_tags.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });

    // Preview tools
    expect(registered.preview_reply_comment.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(registered.preview_publish_image.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(registered.preview_send_dm.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
    });

    // Execute tools
    expect(registered.execute_reply_comment.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(registered.execute_modify_comment.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    expect(registered.execute_publish_image.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    expect(registered.execute_send_dm.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
  });
});
