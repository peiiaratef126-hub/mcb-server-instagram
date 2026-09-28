import { describe, it, expect } from "vitest";
import { getAccountInsightsTool } from "./account-insights.js";
import { MockInstagramGraphProvider, FIXTURES } from "../providers/mock-provider.js";

describe("Feature 10: Account Insights Tool (get_account_insights)", () => {
  it("should fetch account insights with default metrics and period", async () => {
    const mockProvider = new MockInstagramGraphProvider();

    const result = await getAccountInsightsTool.execute({}, mockProvider);

    expect(result.data).toHaveLength(2);
    expect(result.data[0].name).toBe("impressions");
    expect(result.data[0].values[0].value).toBe(4320);

    const call = mockProvider.callHistory[0];
    expect(call.endpoint).toBe("17841400000000000/insights");
    expect(call.options?.params?.period).toBe("day");
    expect(call.options?.params?.metric).toContain("reach");
  });

  it("should support custom metrics, period, and time ranges", async () => {
    const mockProvider = new MockInstagramGraphProvider();

    await getAccountInsightsTool.execute(
      {
        metrics: ["reach", "total_interactions"],
        period: "days_28",
        since: "2026-09-01",
        until: "2026-09-28",
      },
      mockProvider
    );

    const call = mockProvider.callHistory[0];
    expect(call.options?.params?.metric).toBe("reach,total_interactions");
    expect(call.options?.params?.period).toBe("days_28");
    expect(call.options?.params?.since).toBe("2026-09-01");
    expect(call.options?.params?.until).toBe("2026-09-28");
  });
});
