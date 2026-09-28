import { describe, it, expect } from "vitest";
import { getRecentPostsTool } from "./recent-posts.js";
import { MockInstagramGraphProvider, FIXTURES } from "../providers/mock-provider.js";

describe("Feature 2: Recent Posts Tool (get_recent_posts)", () => {
  it("should fetch recent posts using default limit and configured account ID", async () => {
    const mockProvider = new MockInstagramGraphProvider();

    const result = await getRecentPostsTool.execute({}, mockProvider);

    expect(result.data).toHaveLength(2);
    expect(result.data[0].id).toBe("17900000000000001");
    expect(result.data[0].media_type).toBe("IMAGE");
    expect(mockProvider.callHistory[0].endpoint).toBe("17841400000000000/media");
    expect(mockProvider.callHistory[0].options?.params?.limit).toBe(25);
  });

  it("should support custom pagination parameters", async () => {
    const mockProvider = new MockInstagramGraphProvider();

    await getRecentPostsTool.execute(
      {
        limit: 10,
        after: "CURSOR_AFTER_ABC",
      },
      mockProvider
    );

    const call = mockProvider.callHistory[0];
    expect(call.options?.params?.limit).toBe(10);
    expect(call.options?.params?.after).toBe("CURSOR_AFTER_ABC");
  });
});
