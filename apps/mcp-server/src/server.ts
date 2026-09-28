import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InstagramGraphProvider } from "./providers/types.js";
import { logger } from "./utils/logger.js";
import { getProfileInfoTool, GetProfileInfoInputSchema } from "./tools/profile.js";
import { getRecentPostsTool, GetRecentPostsInputSchema } from "./tools/recent-posts.js";
import { getPostDetailsTool, GetPostDetailsInputSchema } from "./tools/post-details.js";
import { listCommentsTool, ListCommentsInputSchema } from "./tools/list-comments.js";
import { getAccountInsightsTool, GetAccountInsightsInputSchema } from "./tools/account-insights.js";
import { getPostInsightsTool, GetPostInsightsInputSchema } from "./tools/post-insights.js";
import {
  previewReplyCommentTool,
  PreviewReplyCommentInputSchema,
  executeReplyCommentTool,
  ExecuteReplyCommentInputSchema,
} from "./tools/reply-comment.js";
import {
  previewModifyCommentTool,
  PreviewModifyCommentInputSchema,
  executeModifyCommentTool,
  ExecuteModifyCommentInputSchema,
} from "./tools/modify-comment.js";
import {
  previewPublishImageTool,
  PreviewPublishImageInputSchema,
  executePublishImageTool,
  ExecutePublishImageInputSchema,
} from "./tools/publish-image.js";
import {
  previewPublishVideoTool,
  PreviewPublishVideoInputSchema,
  executePublishVideoTool,
  ExecutePublishVideoInputSchema,
} from "./tools/publish-video.js";
import {
  previewPublishCarouselTool,
  PreviewPublishCarouselInputSchema,
  executePublishCarouselTool,
  ExecutePublishCarouselInputSchema,
} from "./tools/publish-carousel.js";
import {
  previewSchedulePostTool,
  PreviewSchedulePostInputSchema,
  executeSchedulePostTool,
  ExecuteSchedulePostInputSchema,
} from "./tools/schedule-post.js";
import {
  getUserTagsTool,
  GetUserTagsInputSchema,
  getMentionsTool,
  GetMentionsInputSchema,
} from "./tools/mentions-tags.js";
import {
  listConversationsTool,
  ListConversationsInputSchema,
  getConversationMessagesTool,
  GetConversationMessagesInputSchema,
  previewSendDmTool,
  PreviewSendDmInputSchema,
  executeSendDmTool,
  ExecuteSendDmInputSchema,
} from "./tools/direct-messages.js";
import {
  searchHashtagTool,
  SearchHashtagInputSchema,
  getHashtagMediaTool,
  GetHashtagMediaInputSchema,
} from "./tools/hashtags.js";
import {
  getCompetitorProfileTool,
  GetCompetitorProfileInputSchema,
} from "./tools/business-discovery.js";
import { BaseError } from "./errors/index.js";

export const SERVER_NAME = "mcb-server-instagram";
export const SERVER_VERSION = "0.3.0";

function formatErrorResponse(error: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  logger.error("Tool execution failed", { error: error instanceof Error ? error.message : String(error) });
  const message = error instanceof BaseError ? error.message : error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: "text",
        text: `Error executing tool: ${message}`,
      },
    ],
    isError: true,
  };
}

/**
 * Creates and registers all Instagram tools on an McpServer instance.
 */
export function createMcpServer(provider: InstagramGraphProvider): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Feature 1: Profile Info
  server.tool(
    getProfileInfoTool.name,
    getProfileInfoTool.description,
    GetProfileInfoInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (args) => {
      try {
        const result = await getProfileInfoTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  // Feature 2: Recent Posts
  server.tool(
    getRecentPostsTool.name,
    getRecentPostsTool.description,
    GetRecentPostsInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (args) => {
      try {
        const result = await getRecentPostsTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  // Feature 3: Post Details
  server.tool(
    getPostDetailsTool.name,
    getPostDetailsTool.description,
    GetPostDetailsInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (args) => {
      try {
        const result = await getPostDetailsTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  // Feature 7: List Comments
  server.tool(
    listCommentsTool.name,
    listCommentsTool.description,
    ListCommentsInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (args) => {
      try {
        const result = await listCommentsTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  // Feature 10: Account Insights
  server.tool(
    getAccountInsightsTool.name,
    getAccountInsightsTool.description,
    GetAccountInsightsInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (args) => {
      try {
        const result = await getAccountInsightsTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  // Feature 11: Post Insights
  server.tool(
    getPostInsightsTool.name,
    getPostInsightsTool.description,
    GetPostInsightsInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (args) => {
      try {
        const result = await getPostInsightsTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  // Feature 8: Reply to Comment (Preview & Execute)
  server.tool(
    previewReplyCommentTool.name,
    previewReplyCommentTool.description,
    PreviewReplyCommentInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    async (args) => {
      try {
        const result = await previewReplyCommentTool.execute(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  server.tool(
    executeReplyCommentTool.name,
    executeReplyCommentTool.description,
    ExecuteReplyCommentInputSchema.shape,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async (args) => {
      try {
        const result = await executeReplyCommentTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  // Feature 9: Modify / Delete Comment (Preview & Execute)
  server.tool(
    previewModifyCommentTool.name,
    previewModifyCommentTool.description,
    PreviewModifyCommentInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    async (args) => {
      try {
        const result = await previewModifyCommentTool.execute(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  server.tool(
    executeModifyCommentTool.name,
    executeModifyCommentTool.description,
    ExecuteModifyCommentInputSchema.shape,
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async (args) => {
      try {
        const result = await executeModifyCommentTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  // Feature 4: Publish Image (Preview & Execute)
  server.tool(
    previewPublishImageTool.name,
    previewPublishImageTool.description,
    PreviewPublishImageInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    async (args) => {
      try {
        const result = await previewPublishImageTool.execute(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  server.tool(
    executePublishImageTool.name,
    executePublishImageTool.description,
    ExecutePublishImageInputSchema.shape,
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async (args) => {
      try {
        const result = await executePublishImageTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  // Feature 5: Publish Video / Reel (Preview & Execute)
  server.tool(
    previewPublishVideoTool.name,
    previewPublishVideoTool.description,
    PreviewPublishVideoInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    async (args) => {
      try {
        const result = await previewPublishVideoTool.execute(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  server.tool(
    executePublishVideoTool.name,
    executePublishVideoTool.description,
    ExecutePublishVideoInputSchema.shape,
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async (args) => {
      try {
        const result = await executePublishVideoTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  // Feature 6: Publish Carousel (Preview & Execute)
  server.tool(
    previewPublishCarouselTool.name,
    previewPublishCarouselTool.description,
    PreviewPublishCarouselInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    async (args) => {
      try {
        const result = await previewPublishCarouselTool.execute(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  server.tool(
    executePublishCarouselTool.name,
    executePublishCarouselTool.description,
    ExecutePublishCarouselInputSchema.shape,
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async (args) => {
      try {
        const result = await executePublishCarouselTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  // Feature 15: Schedule Post (Preview & Execute)
  server.tool(
    previewSchedulePostTool.name,
    previewSchedulePostTool.description,
    PreviewSchedulePostInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    async (args) => {
      try {
        const result = await previewSchedulePostTool.execute(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  server.tool(
    executeSchedulePostTool.name,
    executeSchedulePostTool.description,
    ExecuteSchedulePostInputSchema.shape,
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async (args) => {
      try {
        const result = await executeSchedulePostTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  // Feature 12: Mentions & Tags
  server.tool(
    getUserTagsTool.name,
    getUserTagsTool.description,
    GetUserTagsInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (args) => {
      try {
        const result = await getUserTagsTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  server.tool(
    getMentionsTool.name,
    getMentionsTool.description,
    GetMentionsInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (args) => {
      try {
        const result = await getMentionsTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  // Feature 14: Direct Messages (Read & Write with Two-Step Confirmation)
  server.tool(
    listConversationsTool.name,
    listConversationsTool.description,
    ListConversationsInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (args) => {
      try {
        const result = await listConversationsTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  server.tool(
    getConversationMessagesTool.name,
    getConversationMessagesTool.description,
    GetConversationMessagesInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (args) => {
      try {
        const result = await getConversationMessagesTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  server.tool(
    previewSendDmTool.name,
    previewSendDmTool.description,
    PreviewSendDmInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    async (args) => {
      try {
        const result = await previewSendDmTool.execute(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  server.tool(
    executeSendDmTool.name,
    executeSendDmTool.description,
    ExecuteSendDmInputSchema.shape,
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async (args) => {
      try {
        const result = await executeSendDmTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  // Feature 13: Hashtag Search & Discovery
  server.tool(
    searchHashtagTool.name,
    searchHashtagTool.description,
    SearchHashtagInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (args) => {
      try {
        const result = await searchHashtagTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  server.tool(
    getHashtagMediaTool.name,
    getHashtagMediaTool.description,
    GetHashtagMediaInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (args) => {
      try {
        const result = await getHashtagMediaTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  // Feature 25: Competitor Analysis via Business Discovery
  server.tool(
    getCompetitorProfileTool.name,
    getCompetitorProfileTool.description,
    GetCompetitorProfileInputSchema.shape,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (args) => {
      try {
        const result = await getCompetitorProfileTool.execute(args, provider);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatErrorResponse(err);
      }
    }
  );

  return server;
}
