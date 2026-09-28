import { z } from "zod";
import { InstagramGraphProvider } from "../providers/types.js";
import { logger } from "../utils/logger.js";

export const DEFAULT_POST_METRICS = [
  "reach",
  "saved",
  "total_interactions",
] as const;

export const GetPostInsightsInputSchema = z.object({
  media_id: z
    .string()
    .trim()
    .min(1, "media_id is required")
    .describe("Instagram Media ID of the post whose insights are being retrieved."),
  metrics: z
    .array(z.string().trim())
    .default([...DEFAULT_POST_METRICS])
    .describe(
      "Metrics to query on the media object (e.g. reach, saved, total_interactions, impressions, likes, comments, shares, plays)."
    ),
});

export type GetPostInsightsInput = z.infer<typeof GetPostInsightsInputSchema>;

export interface PostInsightValue {
  value: number;
}

export interface PostInsightMetricItem {
  name: string;
  period: string;
  values: PostInsightValue[];
  title?: string;
  description?: string;
  id: string;
}

export interface PostInsightsResponse {
  data: PostInsightMetricItem[];
}

export const getPostInsightsTool = {
  name: "get_post_insights",
  description:
    "Retrieve post-level engagement and reach insights for an Instagram post from official Meta Graph API v21.0.",
  inputSchema: GetPostInsightsInputSchema,
  execute: async (
    rawInput: GetPostInsightsInput,
    provider: InstagramGraphProvider
  ): Promise<PostInsightsResponse> => {
    const input = GetPostInsightsInputSchema.parse(rawInput);
    const metricsToFetch =
      input.metrics && input.metrics.length > 0
        ? input.metrics.join(",")
        : DEFAULT_POST_METRICS.join(",");

    logger.debug(`[get_post_insights] Fetching insights for media_id: ${input.media_id}`, {
      metrics: metricsToFetch,
    });

    const endpoint = `${input.media_id}/insights`;
    const response = await provider.get<PostInsightsResponse>(endpoint, {
      params: { metric: metricsToFetch },
    });

    return response;
  },
};
