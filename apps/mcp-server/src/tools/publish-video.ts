import { z } from "zod";
import { InstagramGraphProvider } from "../providers/types.js";
import { confirmationStore } from "../security/confirmation.js";
import { logger } from "../utils/logger.js";

export const PreviewPublishVideoInputSchema = z.object({
  video_url: z
    .string()
    .trim()
    .url("video_url must be a valid public HTTPS URL")
    .startsWith("https://", "video_url must use HTTPS protocol")
    .describe("Publicly accessible HTTPS URL of the video (MP4/MOV) to publish."),
  caption: z
    .string()
    .trim()
    .max(2200, "Instagram captions cannot exceed 2200 characters")
    .optional()
    .describe("Optional caption for the video or Reel. Max 2200 characters. UNTRUSTED external input."),
  is_reels: z
    .boolean()
    .default(true)
    .describe("Whether to publish as an Instagram Reel (9:16 vertical video) or Feed Video. Defaults to true."),
});

export type PreviewPublishVideoInput = z.infer<typeof PreviewPublishVideoInputSchema>;

export const ExecutePublishVideoInputSchema = z.object({
  confirmation_id: z
    .string()
    .trim()
    .uuid("confirmation_id must be a valid UUID")
    .describe("The one-time confirmation ID issued by preview_publish_video. No other parameters accepted."),
});

export type ExecutePublishVideoInput = z.infer<typeof ExecutePublishVideoInputSchema>;

export interface PreviewPublishVideoResponse {
  confirmation_id: string;
  action: "PUBLISH_MEDIA";
  media_type: "VIDEO" | "REELS";
  preview_summary: string;
  expires_at: string;
  instructions: string;
}

export interface ExecutePublishVideoResponse {
  success: boolean;
  published_media_id: string;
  container_id: string;
}

export const previewPublishVideoTool = {
  name: "preview_publish_video",
  description:
    "Step 1 of 2: Generate an exact preview and an ephemeral 5-minute confirmation ID to publish a Video or Reel to Instagram. Does NOT publish immediately.",
  inputSchema: PreviewPublishVideoInputSchema,
  execute: async (
    rawInput: PreviewPublishVideoInput
  ): Promise<PreviewPublishVideoResponse> => {
    const input = PreviewPublishVideoInputSchema.parse(rawInput);
    const mediaType = input.is_reels ? "REELS" : "VIDEO";
    const escapedCaption = input.caption ? ` Caption: "${input.caption.replace(/"/g, '\\"')}"` : " (No caption)";
    const previewSummary = `Publish ${mediaType} from URL ${input.video_url}.${escapedCaption}`;

    const confirmation = confirmationStore.create({
      toolName: executePublishVideoTool.name,
      action: "PUBLISH_MEDIA",
      targetId: `new_${mediaType.toLowerCase()}_post`,
      payload: {
        media_type: mediaType,
        video_url: input.video_url,
        caption: input.caption,
        is_reels: input.is_reels,
      },
      previewSummary,
    });

    logger.info(`[preview_publish_video] Generated confirmation ${confirmation.id} for ${mediaType}`);

    return {
      confirmation_id: confirmation.id,
      action: "PUBLISH_MEDIA",
      media_type: mediaType,
      preview_summary: previewSummary,
      expires_at: new Date(confirmation.expiresAt).toISOString(),
      instructions:
        "Review the preview carefully. To execute, call 'execute_publish_video' with this confirmation_id within 5 minutes.",
    };
  },
};

export const executePublishVideoTool = {
  name: "execute_publish_video",
  description:
    "Step 2 of 2: Execute a confirmed video or Reel publication using the one-time confirmation ID generated in Step 1. Accepts ONLY confirmation_id.",
  inputSchema: ExecutePublishVideoInputSchema,
  execute: async (
    rawInput: ExecutePublishVideoInput,
    provider: InstagramGraphProvider
  ): Promise<ExecutePublishVideoResponse> => {
    const input = ExecutePublishVideoInputSchema.parse(rawInput);

    const confirmation = confirmationStore.consume<{
      media_type: string;
      video_url: string;
      caption?: string;
      is_reels: boolean;
    }>(input.confirmation_id, executePublishVideoTool.name);

    logger.info(`[execute_publish_video] Executing video publication via confirmation ${confirmation.id}`);

    const accountId = await provider.getAccountId();

    // 1. Create container
    const containerResp = await provider.post<{ id: string }>(`${accountId}/media`, {
      video_url: confirmation.payload.video_url,
      caption: confirmation.payload.caption,
      media_type: confirmation.payload.media_type,
    });

    const containerId = containerResp.id;

    // 2. Publish container
    const publishResp = await provider.post<{ id: string }>(`${accountId}/media_publish`, {
      creation_id: containerId,
    });

    return {
      success: true,
      published_media_id: publishResp.id || containerId,
      container_id: containerId,
    };
  },
};
