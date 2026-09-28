import { z } from "zod";
import { InstagramGraphProvider } from "../providers/types.js";
import { logger } from "../utils/logger.js";

export const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const BENCHMARK_SLOTS = [
  { day_of_week: 2, day_name: "Wednesday", hour: 11, score: 85.0, confidence: "benchmark" },
  { day_of_week: 4, day_name: "Friday", hour: 10, score: 82.0, confidence: "benchmark" },
  { day_of_week: 1, day_name: "Tuesday", hour: 14, score: 80.0, confidence: "benchmark" },
  { day_of_week: 3, day_name: "Thursday", hour: 19, score: 78.0, confidence: "benchmark" },
  { day_of_week: 0, day_name: "Monday", hour: 12, score: 75.0, confidence: "benchmark" },
];

export const GetBestTimeToPostInputSchema = z.object({
  account_id: z
    .string()
    .trim()
    .regex(/^\d+$/, "Instagram Account ID must be a numeric string")
    .optional()
    .describe("Optional Instagram Business Account ID. Defaults to configured account."),
  lookback_posts: z
    .number()
    .int()
    .min(5)
    .max(100)
    .default(30)
    .describe("Number of historical posts to analyze for engagement trends (default 30)."),
  min_confidence_posts: z
    .number()
    .int()
    .min(1)
    .default(3)
    .describe("Minimum number of historical posts required to use account data instead of industry benchmarks (default 3)."),
});

export type GetBestTimeToPostInput = z.infer<typeof GetBestTimeToPostInputSchema>;

export interface TimeSlotRecommendation {
  day_of_week: number;
  day_name: string;
  hour: number;
  score: number;
  sample_size: number;
  confidence: "high" | "medium" | "low" | "benchmark";
  avg_likes: number;
  avg_comments: number;
}

export interface BestTimeToPostResponse {
  ranked_slots: TimeSlotRecommendation[];
  heatmap: number[][]; // 7 days (0=Mon..6=Sun) x 24 hours (0..23)
  best_overall_day: string;
  best_overall_hour: number;
  confidence_level: "high" | "medium" | "low" | "benchmark";
  total_posts_analyzed: number;
  recommendations_summary: string;
}

interface RawMediaItem {
  id: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
}

interface MediaListApiResponse {
  data: RawMediaItem[];
}

export function computeBestTimeToPost(
  posts: RawMediaItem[],
  minConfidencePosts: number = 3
): BestTimeToPostResponse {
  // Parse valid posts
  const parsed = posts
    .map((p) => {
      const dt = new Date(p.timestamp);
      if (isNaN(dt.getTime())) return null;

      // getUTCDay(): 0=Sunday, 1=Monday... Convert to 0=Monday..6=Sunday
      const rawDay = dt.getUTCDay();
      const dow = (rawDay + 6) % 7;
      const hour = dt.getUTCHours();
      const likes = p.like_count ?? 0;
      const comments = p.comments_count ?? 0;
      const score = likes * 1.0 + comments * 2.0;

      return { id: p.id, dow, hour, likes, comments, score };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (parsed.length < minConfidencePosts) {
    // Return benchmark fallback
    const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(5.0));
    const ranked_slots: TimeSlotRecommendation[] = [];

    for (const b of BENCHMARK_SLOTS) {
      heatmap[b.day_of_week][b.hour] = b.score;
      if (b.hour > 0) heatmap[b.day_of_week][b.hour - 1] = Math.max(heatmap[b.day_of_week][b.hour - 1], b.score * 0.75);
      if (b.hour < 23) heatmap[b.day_of_week][b.hour + 1] = Math.max(heatmap[b.day_of_week][b.hour + 1], b.score * 0.75);

      ranked_slots.push({
        day_of_week: b.day_of_week,
        day_name: b.day_name,
        hour: b.hour,
        score: b.score,
        sample_size: 0,
        confidence: "benchmark",
        avg_likes: 0,
        avg_comments: 0,
      });
    }

    return {
      ranked_slots,
      heatmap,
      best_overall_day: "Wednesday",
      best_overall_hour: 11,
      confidence_level: "benchmark",
      total_posts_analyzed: parsed.length,
      recommendations_summary: `Insufficient historical posts (${parsed.length} found, minimum is ${minConfidencePosts}). Recommendations are based on cross-industry Instagram benchmarks (UTC). Top suggested slot: Wednesday at 11:00 UTC.`,
    };
  }

  // Aggregate by slot
  const slotMap = new Map<string, { count: number; totalScore: number; totalLikes: number; totalComments: number }>();
  for (const p of parsed) {
    const key = `${p.dow}:${p.hour}`;
    const entry = slotMap.get(key) || { count: 0, totalScore: 0, totalLikes: 0, totalComments: 0 };
    entry.count += 1;
    entry.totalScore += p.score;
    entry.totalLikes += p.likes;
    entry.totalComments += p.comments;
    slotMap.set(key, entry);
  }

  // Find min and max score for normalization
  let maxScore = -Infinity;
  let minScore = Infinity;
  for (const entry of slotMap.values()) {
    const mean = entry.totalScore / entry.count;
    if (mean > maxScore) maxScore = mean;
    if (mean < minScore) minScore = mean;
  }
  const scoreRange = Math.max(maxScore - minScore, 1e-6);

  // Build base heatmap
  const rawHeatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(10.0));
  for (const [key, entry] of slotMap.entries()) {
    const [dowStr, hrStr] = key.split(":");
    const dow = parseInt(dowStr, 10);
    const hr = parseInt(hrStr, 10);
    const mean = entry.totalScore / entry.count;
    const norm = ((mean - minScore) / scoreRange) * 80.0 + 20.0;
    rawHeatmap[dow][hr] = norm;
  }

  // 1D smoothing across adjacent hours
  const smoothedHeatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(10.0));
  for (let dow = 0; dow < 7; dow++) {
    for (let hr = 0; hr < 24; hr++) {
      const prevHr = (hr - 1 + 24) % 24;
      const nextHr = (hr + 1) % 24;
      smoothedHeatmap[dow][hr] = Math.round(
        (0.20 * rawHeatmap[dow][prevHr] + 0.60 * rawHeatmap[dow][hr] + 0.20 * rawHeatmap[dow][nextHr]) * 10
      ) / 10;
    }
  }

  // Rank recommendations
  const ranked_slots: TimeSlotRecommendation[] = [];
  for (const [key, entry] of slotMap.entries()) {
    const [dowStr, hrStr] = key.split(":");
    const dow = parseInt(dowStr, 10);
    const hr = parseInt(hrStr, 10);
    const samples = entry.count;
    const smoothScore = smoothedHeatmap[dow][hr];

    const confidenceFactor = Math.min(samples / (samples + 2.0), 1.0);
    const finalScore = Math.round(smoothScore * (0.7 + 0.3 * confidenceFactor) * 10) / 10;

    let conf: "high" | "medium" | "low" = "low";
    if (samples >= 5) conf = "high";
    else if (samples >= 2) conf = "medium";

    ranked_slots.push({
      day_of_week: dow,
      day_name: DAYS_OF_WEEK[dow],
      hour: hr,
      score: finalScore,
      sample_size: samples,
      confidence: conf,
      avg_likes: Math.round((entry.totalLikes / samples) * 10) / 10,
      avg_comments: Math.round((entry.totalComments / samples) * 10) / 10,
    });
  }

  ranked_slots.sort((a, b) => b.score - a.score || b.sample_size - a.sample_size);

  // Overall best day and hour
  const dayScores = Array(7).fill(0);
  const dayCounts = Array(7).fill(0);
  const hourScores = Array(24).fill(0);
  const hourCounts = Array(24).fill(0);

  for (const p of parsed) {
    dayScores[p.dow] += p.score;
    dayCounts[p.dow] += 1;
    hourScores[p.hour] += p.score;
    hourCounts[p.hour] += 1;
  }

  let bestDow = 0;
  let maxDayAvg = -1;
  for (let d = 0; d < 7; d++) {
    const avg = dayCounts[d] > 0 ? dayScores[d] / dayCounts[d] : 0;
    if (avg > maxDayAvg) {
      maxDayAvg = avg;
      bestDow = d;
    }
  }

  let bestHr = 0;
  let maxHrAvg = -1;
  for (let h = 0; h < 24; h++) {
    const avg = hourCounts[h] > 0 ? hourScores[h] / hourCounts[h] : 0;
    if (avg > maxHrAvg) {
      maxHrAvg = avg;
      bestHr = h;
    }
  }

  const topRec = ranked_slots[0];
  const summary = `Analyzed ${parsed.length} historical posts. Optimal publishing window is ${topRec ? `${topRec.day_name} at ${topRec.hour.toString().padStart(2, "0")}:00 UTC` : `${DAYS_OF_WEEK[bestDow]} at ${bestHr.toString().padStart(2, "0")}:00 UTC`}. Peak engagement historically occurs on ${DAYS_OF_WEEK[bestDow]}s around ${bestHr.toString().padStart(2, "0")}:00 UTC.`;

  return {
    ranked_slots: ranked_slots.slice(0, 10),
    heatmap: smoothedHeatmap,
    best_overall_day: DAYS_OF_WEEK[bestDow],
    best_overall_hour: bestHr,
    confidence_level: parsed.length >= 15 ? "high" : "medium",
    total_posts_analyzed: parsed.length,
    recommendations_summary: summary,
  };
}

export const getBestTimeToPostTool = {
  name: "get_best_time_to_post",
  description:
    "Analyze historical post performance to recommend the optimal days and hours to publish on Instagram. Returns an engagement heatmap (7 days x 24 hours UTC) and ranked time slot recommendations.",
  inputSchema: GetBestTimeToPostInputSchema,
  execute: async (
    rawInput: GetBestTimeToPostInput,
    provider: InstagramGraphProvider
  ): Promise<BestTimeToPostResponse> => {
    const input = GetBestTimeToPostInputSchema.parse(rawInput);
    const targetAccountId = input.account_id || (await provider.getAccountId());

    logger.info(`[get_best_time_to_post] Analyzing historical performance for account ${targetAccountId}`, {
      lookback_posts: input.lookback_posts,
    });

    const endpoint = `${targetAccountId}/media`;
    const response = await provider.get<MediaListApiResponse>(endpoint, {
      params: {
        fields: "id,timestamp,like_count,comments_count",
        limit: input.lookback_posts,
      },
    });

    const posts = response.data || [];
    return computeBestTimeToPost(posts, input.min_confidence_posts);
  },
};
