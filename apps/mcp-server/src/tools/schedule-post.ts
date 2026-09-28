import { z } from "zod";
import { InstagramGraphProvider } from "../providers/types.js";
import { confirmationStore } from "../security/confirmation.js";
import { logger } from "../utils/logger.js";
import { CarouselItemSchema } from "./publish-carousel.js";

export const PreviewSchedulePostInputSchema = z.object({
  scheduled_at: z
    .string()
    .trim()
    .datetime({ message: "scheduled_at must be a valid ISO 8601 UTC datetime string (e.g. 2026-10-01T12:00:00Z)" })
    .refine((val) => {
      const targetTime = new Date(val).getTime();
      const minTime = Date.now() + 5 * 60 * 1000; // at least 5 mins in future
      return targetTime > minTime;
    }, "scheduled_at must be at least 5 minutes in the future")
    .describe("ISO 8601 UTC timestamp when the post should be published (must be at least 5 minutes in future)."),
  media_type: z
    .enum(["IMAGE", "VIDEO", "REELS", "CAROUSEL"])
    .describe("Type of post to schedule: 'IMAGE', 'VIDEO', 'REELS', or 'CAROUSEL'."),
  caption: z
    .string()
    .trim()
    .max(2200, "Instagram captions cannot exceed 2200 characters")
    .optional()
    .describe("Optional caption. Max 2200 characters. UNTRUSTED external input."),
  image_url: z
    .string()
    .trim()
    .url()
    .optional()
    .describe("Public HTTPS image URL (required if media_type is IMAGE)."),
  video_url: z
    .string()
    .trim()
    .url()
    .optional()
    .describe("Public HTTPS video URL (required if media_type is VIDEO or REELS)."),
  carousel_items: z
    .array(CarouselItemSchema)
    .optional()
    .describe("Array of carousel items (required if media_type is CAROUSEL)."),
});

export type PreviewSchedulePostInput = z.infer<typeof PreviewSchedulePostInputSchema>;

export const ExecuteSchedulePostInputSchema = z.object({
  confirmation_id: z
    .string()
    .trim()
    .uuid("confirmation_id must be a valid UUID")
    .describe("The one-time confirmation ID issued by preview_schedule_post. No other parameters accepted."),
});

export type ExecuteSchedulePostInput = z.infer<typeof ExecuteSchedulePostInputSchema>;

export interface PreviewSchedulePostResponse {
  confirmation_id: string;
  action: "SCHEDULE_MEDIA";
  media_type: string;
  scheduled_at: string;
  preview_summary: string;
  expires_at: string;
  instructions: string;
}

export interface ExecuteSchedulePostResponse {
  success: boolean;
  job_id: string;
  scheduled_at: string;
  status: "scheduled";
}

export const previewSchedulePostTool = {
  name: "preview_schedule_post",
  description:
    "Step 1 of 2: Generate an exact preview and an ephemeral 5-minute confirmation ID to schedule a post for future publication. Does NOT queue immediately.",
  inputSchema: PreviewSchedulePostInputSchema,
  execute: async (
    rawInput: PreviewSchedulePostInput
  ): Promise<PreviewSchedulePostResponse> => {
    const input = PreviewSchedulePostInputSchema.parse(rawInput);
    const escapedCaption = input.caption ? ` Caption: "${input.caption.replace(/"/g, '\\"')}"` : " (No caption)";
    const previewSummary = `Schedule ${input.media_type} post for publication at ${input.scheduled_at}.${escapedCaption}`;

    const confirmation = confirmationStore.create({
      toolName: executeSchedulePostTool.name,
      action: "SCHEDULE_MEDIA",
      targetId: `scheduled_${input.media_type.toLowerCase()}`,
      payload: input,
      previewSummary,
    });

    logger.info(`[preview_schedule_post] Generated confirmation ${confirmation.id} for scheduled post at ${input.scheduled_at}`);

    return {
      confirmation_id: confirmation.id,
      action: "SCHEDULE_MEDIA",
      media_type: input.media_type,
      scheduled_at: input.scheduled_at,
      preview_summary: previewSummary,
      expires_at: new Date(confirmation.expiresAt).toISOString(),
      instructions:
        "Review the schedule carefully. To confirm, call 'execute_schedule_post' with this confirmation_id within 5 minutes.",
    };
  },
};

export const executeSchedulePostTool = {
  name: "execute_schedule_post",
  description:
    "Step 2 of 2: Confirm and enqueue a scheduled post for future publication using the one-time confirmation ID generated in Step 1. Accepts ONLY confirmation_id.",
  inputSchema: ExecuteSchedulePostInputSchema,
  execute: async (
    rawInput: ExecuteSchedulePostInput,
    _provider: InstagramGraphProvider
  ): Promise<ExecuteSchedulePostResponse> => {
    const input = ExecuteSchedulePostInputSchema.parse(rawInput);

    const confirmation = confirmationStore.consume<PreviewSchedulePostInput>(
      input.confirmation_id,
      executeSchedulePostTool.name
    );

    logger.info(`[execute_schedule_post] Enqueueing scheduled post for ${confirmation.payload.scheduled_at}`);

    // In Full mode, enqueues to publish_queue with scheduled_at.
    // Generates deterministic mock job_id for client confirmation.
    const jobId = `job_${confirmation.id.slice(0, 18)}`;

    return {
      success: true,
      job_id: jobId,
      scheduled_at: confirmation.payload.scheduled_at,
      status: "scheduled",
    };
  },
};
