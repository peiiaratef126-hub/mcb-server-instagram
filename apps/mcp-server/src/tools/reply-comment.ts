import { z } from "zod";
import { InstagramGraphProvider } from "../providers/types.js";
import { confirmationStore } from "../security/confirmation.js";
import { logger } from "../utils/logger.js";

export const PreviewReplyCommentInputSchema = z.object({
  comment_id: z
    .string()
    .trim()
    .min(1, "comment_id is required")
    .describe("Instagram Comment ID to reply to."),
  message: z
    .string()
    .trim()
    .min(1, "message cannot be empty")
    .max(1000, "message cannot exceed 1000 characters")
    .describe("Reply message text."),
});

export type PreviewReplyCommentInput = z.infer<typeof PreviewReplyCommentInputSchema>;

export const ExecuteReplyCommentInputSchema = z.object({
  confirmation_id: z
    .string()
    .trim()
    .uuid("confirmation_id must be a valid UUID")
    .describe("The one-time confirmation ID issued by preview_reply_comment."),
});

export type ExecuteReplyCommentInput = z.infer<typeof ExecuteReplyCommentInputSchema>;

export interface PreviewReplyResponse {
  confirmation_id: string;
  action: "REPLY_COMMENT";
  target_id: string;
  preview_summary: string;
  expires_at: string;
  instructions: string;
}

export interface ExecuteReplyResponse {
  success: boolean;
  reply_id: string;
  comment_id: string;
}

export const previewReplyCommentTool = {
  name: "preview_reply_comment",
  description:
    "Step 1 of 2: Generate an exact preview and an ephemeral 5-minute confirmation ID to reply to an Instagram comment. Does NOT execute the write action.",
  inputSchema: PreviewReplyCommentInputSchema,
  execute: async (
    rawInput: PreviewReplyCommentInput
  ): Promise<PreviewReplyResponse> => {
    const input = PreviewReplyCommentInputSchema.parse(rawInput);
    const previewSummary = `Reply to comment ${input.comment_id}: "${input.message}"`;

    const confirmation = confirmationStore.create(
      "REPLY_COMMENT",
      input.comment_id,
      { message: input.message },
      previewSummary
    );

    logger.info(`[preview_reply_comment] Generated confirmation for comment ${input.comment_id}`);

    return {
      confirmation_id: confirmation.id,
      action: "REPLY_COMMENT",
      target_id: input.comment_id,
      preview_summary: previewSummary,
      expires_at: new Date(confirmation.expiresAt).toISOString(),
      instructions:
        "To publish this reply, call 'execute_reply_comment' with this confirmation_id within 5 minutes.",
    };
  },
};

export const executeReplyCommentTool = {
  name: "execute_reply_comment",
  description:
    "Step 2 of 2: Execute a confirmed comment reply using the one-time confirmation ID generated in Step 1.",
  inputSchema: ExecuteReplyCommentInputSchema,
  execute: async (
    rawInput: ExecuteReplyCommentInput,
    provider: InstagramGraphProvider
  ): Promise<ExecuteReplyResponse> => {
    const input = ExecuteReplyCommentInputSchema.parse(rawInput);

    // Burns confirmation single-use or throws
    const confirmation = confirmationStore.consume<{ message: string }>(
      input.confirmation_id,
      "REPLY_COMMENT"
    );

    logger.info(
      `[execute_reply_comment] Executing reply to comment ${confirmation.targetId} via confirmation ${input.confirmation_id}`
    );

    const endpoint = `${confirmation.targetId}/replies`;
    const response = await provider.post<{ id: string }>(endpoint, {
      message: confirmation.payload.message,
    });

    return {
      success: true,
      reply_id: response.id,
      comment_id: confirmation.targetId,
    };
  },
};
