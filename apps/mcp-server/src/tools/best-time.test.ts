import { describe, it, expect } from "vitest";
import { MockInstagramGraphProvider } from "../providers/mock-provider.js";
import {
  getBestTimeToPostTool,
  computeBestTimeToPost,
} from "./best-time.js";

describe("Feature 23: Best Time to Post Tool", () => {
  it("returns industry benchmarks when post history is under minimum threshold", () => {
    const result = computeBestTimeToPost([], 3);
    expect(result.confidence_level).toBe("benchmark");
    expect(result.total_posts_analyzed).toBe(0);
    expect(result.ranked_slots.length).toBe(5);
    expect(result.best_overall_day).toBe("Wednesday");
    expect(result.best_overall_hour).toBe(11);
    expect(result.heatmap.length).toBe(7);
    expect(result.heatmap[0].length).toBe(24);
  });

  it("calculates optimal slots from historical post data", () => {
    const syntheticPosts = [
      // High engagement on Friday 18:00 UTC (2026-09-04, 2026-09-11, 2026-09-18)
      { id: "1", timestamp: "2026-09-04T18:00:00Z", like_count: 500, comments_count: 50 },
      { id: "2", timestamp: "2026-09-11T18:15:00Z", like_count: 600, comments_count: 60 },
      { id: "3", timestamp: "2026-09-18T18:30:00Z", like_count: 550, comments_count: 55 },
      // Low engagement on Monday 04:00 UTC
      { id: "4", timestamp: "2026-09-07T04:00:00Z", like_count: 10, comments_count: 1 },
      { id: "5", timestamp: "2026-09-14T04:00:00Z", like_count: 15, comments_count: 2 },
    ];

    const result = computeBestTimeToPost(syntheticPosts, 3);
    expect(result.total_posts_analyzed).toBe(5);
    expect(result.confidence_level).toBe("medium");
    expect(result.best_overall_day).toBe("Friday");
    expect(result.best_overall_hour).toBe(18);

    const topSlot = result.ranked_slots[0];
    expect(topSlot.day_name).toBe("Friday");
    expect(topSlot.hour).toBe(18);
    expect(topSlot.avg_likes).toBeGreaterThan(500);
    expect(topSlot.sample_size).toBe(3);
  });

  it("executes via mock provider and returns ranked recommendations", async () => {
    const provider = new MockInstagramGraphProvider();
    const result = await getBestTimeToPostTool.execute(
      { lookback_posts: 20, min_confidence_posts: 1 },
      provider
    );

    expect(result.heatmap.length).toBe(7);
    expect(result.heatmap[0].length).toBe(24);
    expect(result.recommendations_summary).toBeTruthy();
    expect(result.ranked_slots.length).toBeGreaterThan(0);
  });
});
