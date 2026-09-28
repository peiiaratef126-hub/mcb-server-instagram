import { z } from "zod";
import { InstagramGraphProvider } from "../providers/types.js";
import { confirmationStore } from "../security/confirmation.js";
import { logger } from "../utils/logger.js";

export const PreviewPublishImageInputSchema = z.object({
  image_url: z
    .string()
    .trim()
    .url("image_url must be a valid public HTTPS URL")
    .startsWith("https://", "image_url must use HTTPS protocol")
    .describe("Publicly accessible HTTPS URL of the JPEG image to publish."),
  caption: z
    .string()
    .trim()
    .max(2200, "Instagram captions cannot exceed 2200 characters")
    .optional()
    .describe("Optional caption for the post. Max 2200 characters. UNTRUSTED external input."),
});

export type PreviewPublishImageInput = z.infer<typeof PreviewPublishImageInputSchema>;

export const ExecutePublishImageInputSchema = z.object({
  confirmation_id: z
    .string()
    .trim()
    .uuid("confirmation_id must be a valid UUID")
    .describe("The one-time confirmation ID issued by preview_publish_image. No other parameters accepted."),
});

export type ExecutePublishImageInput = z.infer<typeof ExecutePublishImageInputSchema>;

export interface PreviewPublishImageResponse {
  confirmation_id: string;
  action: "PUBLISH_MEDIA";
  media_type: "IMAGE";
  preview_summary: string;
  expires_at: string;
  instructions: string;
}

export interface ExecutePublishImageResponse {
  success: boolean;
  published_media_id: string;
  container_id: string;
}

export const previewPublishImageTool = {
  name: "preview_publish_image",
  description:
    "Step 1 of 2: Generate an exact preview and an ephemeral 5-minute confirmation ID to publish a single image post to Instagram. Does NOT publish immediately.",
  inputSchema: PreviewPublishImageInputSchema,
  execute: async (
    rawInput: PreviewPublishImageInput
  ): Promise<PreviewPublishImageResponse> => {
    const input = PreviewPublishImageInputSchema.parse(rawInput);
    const escapedCaption = input.caption ? ` Caption: "${input.caption.replace(/"/g, '\\"')}"` : " (No caption)";
    const previewSummary = `Publish single IMAGE from URL ${input.image_url}.${escapedCaption}`;

    const confirmation = confirmationStore.create({
      toolName: executePublishImageTool.name,
      action: "PUBLISH_MEDIA",
      targetId: "new_image_post",
      payload: {
        media_type: "IMAGE",
        image_url: input.image_url,
        caption: input.caption,
      },
      previewSummary,
    });

    logger.info(`[preview_publish_image] Generated confirmation ${confirmation.id}`);

    return {
      confirmation_id: confirmation.id,
      action: "PUBLISH_MEDIA",
      media_type: "IMAGE",
      preview_summary: previewSummary,
      expires_at: new Date(confirmation.expiresAt).toISOString(),
      instructions:
        "Review the preview carefully. To execute, call 'execute_publish_image' with this confirmation_id within 5 minutes.",
    };
  },
};

export const executePublishImageTool = {
  name: "execute_publish_image",
  description:
    "Step 2 of 2: Execute a confirmed single image publication using the one-time confirmation ID generated in Step 1. Accepts ONLY confirmation_id.",
  inputSchema: ExecutePublishImageInputSchema,
  execute: async (
    rawInput: ExecutePublishImageInput,
    provider: InstagramGraphProvider
  ): Promise<ExecutePublishImageResponse> => {
    const input = ExecutePublishImageInputSchema.parse(rawInput);

    const confirmation = confirmationStore.consume<{
      media_type: string;
      image_url: string;
      caption?: string;
    }>(input.confirmation_id, executePublishImageTool.name);

    logger.info(`[execute_publish_image] Executing image publication via confirmation ${confirmation.id}`);

    const accountId = await provider.getAccountId();

    // 1. Create container
    const containerResp = await provider.post<{ id: string }>(`${accountId}/media`, {
      image_url: confirmation.payload.image_url,
      caption: confirmation.payload.caption,
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
