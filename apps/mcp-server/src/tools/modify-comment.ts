import { z } from "zod";
import { InstagramGraphProvider } from "../providers/types.js";
import { confirmationStore, WriteActionType } from "../security/confirmation.js";
import { logger } from "../utils/logger.js";

export const CommentActionTypeSchema = z.enum(["hide", "unhide", "delete"]);
export type CommentActionType = z.infer<typeof CommentActionTypeSchema>;

export const PreviewModifyCommentInputSchema = z.object({
  comment_id: z
    .string()
    .trim()
    .min(1, "comment_id is required")
    .describe("Instagram Comment ID to modify or permanently delete."),
  action: CommentActionTypeSchema.describe(
    "Action to perform: 'hide' (hides comment from public view), 'unhide' (makes comment visible again), or 'delete' (permanently and irreversibly removes comment)."
  ),
});

export type PreviewModifyCommentInput = z.infer<typeof PreviewModifyCommentInputSchema>;

export const ExecuteModifyCommentInputSchema = z.object({
  confirmation_id: z
    .string()
    .trim()
    .uuid("confirmation_id must be a valid UUID")
    .describe("The one-time confirmation ID issued by preview_modify_comment. No other parameters accepted."),
});

export type ExecuteModifyCommentInput = z.infer<typeof ExecuteModifyCommentInputSchema>;

export interface PreviewModifyCommentResponse {
  confirmation_id: string;
  action: WriteActionType;
  target_id: string;
  preview_summary: string;
  expires_at: string;
  instructions: string;
}

export interface ExecuteModifyCommentResponse {
  success: boolean;
  comment_id: string;
  action: CommentActionType;
}

export const previewModifyCommentTool = {
  name: "preview_modify_comment",
  description:
    "Step 1 of 2: Generate an exact preview and an ephemeral 5-minute confirmation ID to hide, unhide, or permanently delete an Instagram comment. Does NOT execute the write action.",
  inputSchema: PreviewModifyCommentInputSchema,
  execute: async (
    rawInput: PreviewModifyCommentInput
  ): Promise<PreviewModifyCommentResponse> => {
    const input = PreviewModifyCommentInputSchema.parse(rawInput);

    let writeAction: WriteActionType;
    let previewSummary: string;
    let payload: { hide?: boolean } = {};

    switch (input.action) {
      case "hide":
        writeAction = "HIDE_COMMENT";
        payload = { hide: true };
        previewSummary = `Hide comment ${input.comment_id} from public view (comment remains recoverable)`;
        break;
      case "unhide":
        writeAction = "UNHIDE_COMMENT";
        payload = { hide: false };
        previewSummary = `Unhide comment ${input.comment_id} (make publicly visible again)`;
        break;
      case "delete":
        writeAction = "DELETE_COMMENT";
        previewSummary = `WARNING: PERMANENTLY DELETE comment ${input.comment_id} (irreversible action - this CANNOT be undone).`;
        break;
    }

    const confirmation = confirmationStore.create({
      toolName: executeModifyCommentTool.name,
      action: writeAction,
      targetId: input.comment_id,
      payload,
      previewSummary,
    });

    logger.info(`[preview_modify_comment] Generated confirmation for comment ${input.comment_id} (Action: ${writeAction})`);

    return {
      confirmation_id: confirmation.id,
      action: writeAction,
      target_id: input.comment_id,
      preview_summary: previewSummary,
      expires_at: new Date(confirmation.expiresAt).toISOString(),
      instructions:
        "To execute this action, call 'execute_modify_comment' with this confirmation_id within 5 minutes.",
    };
  },
};

export const executeModifyCommentTool = {
  name: "execute_modify_comment",
  description:
    "Step 2 of 2: Execute a confirmed comment hide, unhide, or delete using the one-time confirmation ID generated in Step 1. Accepts ONLY confirmation_id.",
  inputSchema: ExecuteModifyCommentInputSchema,
  execute: async (
    rawInput: ExecuteModifyCommentInput,
    provider: InstagramGraphProvider
  ): Promise<ExecuteModifyCommentResponse> => {
    const input = ExecuteModifyCommentInputSchema.parse(rawInput);

    // Burns confirmation single-use, enforcing tool binding
    const confirmation = confirmationStore.consume<{ hide?: boolean }>(
      input.confirmation_id,
      executeModifyCommentTool.name
    );

    logger.info(
      `[execute_modify_comment] Executing ${confirmation.action} on comment ${confirmation.targetId} via confirmation ${input.confirmation_id}`
    );

    if (confirmation.action === "DELETE_COMMENT") {
      await provider.delete<{ success: boolean }>(confirmation.targetId);
      return {
        success: true,
        comment_id: confirmation.targetId,
        action: "delete",
      };
    } else {
      const hideVal = confirmation.action === "HIDE_COMMENT";
      await provider.post<{ success: boolean }>(confirmation.targetId, undefined, {
        params: { hide: hideVal },
      });
      return {
        success: true,
        comment_id: confirmation.targetId,
        action: hideVal ? "hide" : "unhide",
      };
    }
  },
};
