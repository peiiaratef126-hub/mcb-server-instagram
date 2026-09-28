import { z } from "zod";
import { InstagramGraphProvider } from "../providers/types.js";
import { logger } from "../utils/logger.js";

export const DEFAULT_ACCOUNT_METRICS = [
  "impressions",
  "reach",
  "profile_views",
  "accounts_engaged",
  "total_interactions",
] as const;

export const GetAccountInsightsInputSchema = z.object({
  account_id: z
    .string()
    .trim()
    .regex(/^\d+$/, "Instagram Account ID must be a numeric string")
    .optional()
    .describe("Optional Instagram Business Account ID. Defaults to configured account."),
  metrics: z
    .array(z.string().trim())
    .default([...DEFAULT_ACCOUNT_METRICS])
    .describe(
      "Metrics to query (e.g. impressions, reach, profile_views, accounts_engaged, total_interactions)."
    ),
  period: z
    .enum(["day", "week", "days_28", "total_over_range"])
    .default("day")
    .describe("Aggregation period for the metrics ('day', 'week', 'days_28', 'total_over_range')."),
  metric_type: z
    .enum(["time_series", "total_value"])
    .optional()
    .describe("Optional metric type format ('time_series' or 'total_value')."),
  since: z
    .string()
    .optional()
    .describe("Optional start time as Unix timestamp or YYYY-MM-DD."),
  until: z
    .string()
    .optional()
    .describe("Optional end time as Unix timestamp or YYYY-MM-DD."),
});

export type GetAccountInsightsInput = z.infer<typeof GetAccountInsightsInputSchema>;

export interface InsightValue {
  value: number;
  end_time?: string;
}

export interface InsightMetricItem {
  name: string;
  period: string;
  values: InsightValue[];
  title?: string;
  description?: string;
  id: string;
  total_value?: {
    value: number;
  };
}

export interface AccountInsightsResponse {
  data: InsightMetricItem[];
}

export const getAccountInsightsTool = {
  name: "get_account_insights",
  description:
    "Retrieve account-level performance and engagement insights (e.g. reach, impressions, profile views) from official Meta Graph API v21.0.",
  inputSchema: GetAccountInsightsInputSchema,
  execute: async (
    rawInput: GetAccountInsightsInput,
    provider: InstagramGraphProvider
  ): Promise<AccountInsightsResponse> => {
    const input = GetAccountInsightsInputSchema.parse(rawInput);
    const targetAccountId = input.account_id || (await provider.getAccountId());
    const metricsToFetch =
      input.metrics && input.metrics.length > 0
        ? input.metrics.join(",")
        : DEFAULT_ACCOUNT_METRICS.join(",");

    logger.debug(`[get_account_insights] Fetching insights for account: ${targetAccountId}`, {
      metrics: metricsToFetch,
      period: input.period,
    });

    const params: Record<string, string | number | boolean | undefined> = {
      metric: metricsToFetch,
      period: input.period,
    };

    if (input.metric_type) {
      params.metric_type = input.metric_type;
    }
    if (input.since) {
      params.since = input.since;
    }
    if (input.until) {
      params.until = input.until;
    }

    const endpoint = `${targetAccountId}/insights`;
    const response = await provider.get<AccountInsightsResponse>(endpoint, { params });
    return response;
  },
};
