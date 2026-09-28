import { z } from "zod";
import { InstagramGraphProvider } from "../providers/types.js";
import { confirmationStore } from "../security/confirmation.js";
import { logger } from "../utils/logger.js";

export const CarouselItemSchema = z.object({
  media_type: z.enum(["IMAGE", "VIDEO"]).describe("Type of media item in the carousel: 'IMAGE' or 'VIDEO'."),
  url: z
    .string()
    .trim()
    .url("Each item URL must be a valid public HTTPS URL")
    .startsWith("https://", "Each item URL must use HTTPS protocol")
    .describe("Publicly accessible HTTPS URL of the carousel item."),
});

export const PreviewPublishCarouselInputSchema = z.object({
  items: z
    .array(CarouselItemSchema)
    .min(2, "Carousels must contain at least 2 items")
    .max(10, "Carousels cannot exceed 10 items")
    .describe("Array of 2 to 10 media items comprising the carousel."),
  caption: z
    .string()
    .trim()
    .max(2200, "Instagram captions cannot exceed 2200 characters")
    .optional()
    .describe("Optional caption for the carousel post. Max 2200 characters. UNTRUSTED external input."),
});

export type PreviewPublishCarouselInput = z.infer<typeof PreviewPublishCarouselInputSchema>;

export const ExecutePublishCarouselInputSchema = z.object({
  confirmation_id: z
    .string()
    .trim()
    .uuid("confirmation_id must be a valid UUID")
    .describe("The one-time confirmation ID issued by preview_publish_carousel. No other parameters accepted."),
});

export type ExecutePublishCarouselInput = z.infer<typeof ExecutePublishCarouselInputSchema>;

export interface PreviewPublishCarouselResponse {
  confirmation_id: string;
  action: "PUBLISH_MEDIA";
  media_type: "CAROUSEL";
  item_count: number;
  preview_summary: string;
  expires_at: string;
  instructions: string;
}

export interface ExecutePublishCarouselResponse {
  success: boolean;
  published_media_id: string;
  container_id: string;
  item_count: number;
}

export const previewPublishCarouselTool = {
  name: "preview_publish_carousel",
  description:
    "Step 1 of 2: Generate an exact preview and an ephemeral 5-minute confirmation ID to publish a multi-item Carousel (2-10 images/videos) to Instagram. Does NOT publish immediately.",
  inputSchema: PreviewPublishCarouselInputSchema,
  execute: async (
    rawInput: PreviewPublishCarouselInput
  ): Promise<PreviewPublishCarouselResponse> => {
    const input = PreviewPublishCarouselInputSchema.parse(rawInput);
    const escapedCaption = input.caption ? ` Caption: "${input.caption.replace(/"/g, '\\"')}"` : " (No caption)";
    const previewSummary = `Publish CAROUSEL with ${input.items.length} items.${escapedCaption}`;

    const confirmation = confirmationStore.create({
      toolName: executePublishCarouselTool.name,
      action: "PUBLISH_MEDIA",
      targetId: "new_carousel_post",
      payload: {
        media_type: "CAROUSEL",
        items: input.items,
        caption: input.caption,
      },
      previewSummary,
    });

    logger.info(`[preview_publish_carousel] Generated confirmation ${confirmation.id} for ${input.items.length} items`);

    return {
      confirmation_id: confirmation.id,
      action: "PUBLISH_MEDIA",
      media_type: "CAROUSEL",
      item_count: input.items.length,
      preview_summary: previewSummary,
      expires_at: new Date(confirmation.expiresAt).toISOString(),
      instructions:
        "Review the preview carefully. To execute, call 'execute_publish_carousel' with this confirmation_id within 5 minutes.",
    };
  },
};

export const executePublishCarouselTool = {
  name: "execute_publish_carousel",
  description:
    "Step 2 of 2: Execute a confirmed carousel publication using the one-time confirmation ID generated in Step 1. Accepts ONLY confirmation_id.",
  inputSchema: ExecutePublishCarouselInputSchema,
  execute: async (
    rawInput: ExecutePublishCarouselInput,
    provider: InstagramGraphProvider
  ): Promise<ExecutePublishCarouselResponse> => {
    const input = ExecutePublishCarouselInputSchema.parse(rawInput);

    const confirmation = confirmationStore.consume<{
      media_type: string;
      items: Array<{ media_type: "IMAGE" | "VIDEO"; url: string }>;
      caption?: string;
    }>(input.confirmation_id, executePublishCarouselTool.name);

    logger.info(`[execute_publish_carousel] Executing carousel publication via confirmation ${confirmation.id}`);

    const accountId = await provider.getAccountId();
    const childIds: string[] = [];

    // 1. Create child item containers
    for (const item of confirmation.payload.items) {
      const body =
        item.media_type === "VIDEO"
          ? { video_url: item.url, is_carousel_item: true, media_type: "VIDEO" }
          : { image_url: item.url, is_carousel_item: true };

      const childResp = await provider.post<{ id: string }>(`${accountId}/media`, body);
      childIds.push(childResp.id);
    }

    // 2. Create parent carousel container
    const parentResp = await provider.post<{ id: string }>(`${accountId}/media`, {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption: confirmation.payload.caption,
    });

    const parentContainerId = parentResp.id;

    // 3. Publish parent container
    const publishResp = await provider.post<{ id: string }>(`${accountId}/media_publish`, {
      creation_id: parentContainerId,
    });

    return {
      success: true,
      published_media_id: publishResp.id || parentContainerId,
      container_id: parentContainerId,
      item_count: childIds.length,
    };
  },
};
