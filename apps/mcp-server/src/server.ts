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
import { BaseError } from "./errors/index.js";

export const SERVER_NAME = "mcb-server-instagram";
export const SERVER_VERSION = "0.1.0";

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

  return server;
}
