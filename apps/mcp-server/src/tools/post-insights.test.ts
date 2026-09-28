import { describe, it, expect } from "vitest";
import { getPostInsightsTool } from "./post-insights.js";
import { MockInstagramGraphProvider, FIXTURES } from "../providers/mock-provider.js";

describe("Feature 11: Post Insights Tool (get_post_insights)", () => {
  it("should fetch post insights with default metrics", async () => {
    const mockProvider = new MockInstagramGraphProvider();

    const result = await getPostInsightsTool.execute(
      { media_id: "17900000000000001" },
      mockProvider
    );

    expect(result.data).toHaveLength(2);
    expect(result.data[0].name).toBe("reach");
    expect(result.data[0].values[0].value).toBe(2450);

    const call = mockProvider.callHistory[0];
    expect(call.endpoint).toBe("17900000000000001/insights");
    expect(call.options?.params?.metric).toContain("reach");
    expect(call.options?.params?.metric).toContain("saved");
  });

  it("should allow querying specific custom metrics", async () => {
    const mockProvider = new MockInstagramGraphProvider();

    await getPostInsightsTool.execute(
      {
        media_id: "17900000000000001",
        metrics: ["impressions", "reach"],
      },
      mockProvider
    );

    const call = mockProvider.callHistory[0];
    expect(call.options?.params?.metric).toBe("impressions,reach");
  });
});
