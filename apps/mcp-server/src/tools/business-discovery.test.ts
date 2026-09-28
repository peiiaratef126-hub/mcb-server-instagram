import { describe, it, expect } from "vitest";
import { getCompetitorProfileTool } from "./business-discovery.js";
import { MockInstagramGraphProvider } from "../providers/mock-provider.js";
import { InstagramApiError } from "../errors/index.js";

describe("Feature 25: Competitor Analysis via Business Discovery API", () => {
  it("get_competitor_profile should retrieve public competitor metrics and recent media", async () => {
    const provider = new MockInstagramGraphProvider();
    const result = await getCompetitorProfileTool.execute(
      { target_username: "@competitor_brand", media_limit: 5 },
      provider
    );

    expect(result.username).toBe("competitor_brand");
    expect(result.followers_count).toBe(89400);
    expect(result.media_count).toBe(450);
    expect(result.website).toBe("https://competitor.com");
    expect(result.recent_media).toBeDefined();
    expect(result.recent_media.length).toBeGreaterThan(0);
    expect(result.recent_media[0].id).toBe("17900000000000099");
    expect(result.recent_media[0].caption).toContain("summer collection");
    expect(result.security_warning).toContain("CRITICAL");
  });

  it("should throw InstagramApiError when target profile is not found or not a business/creator account", async () => {
    const provider = new MockInstagramGraphProvider();
    provider.setMockResponse("17841400000000000", {});

    await expect(
      getCompetitorProfileTool.execute({ target_username: "nonexistent_brand" }, provider)
    ).rejects.toThrow(InstagramApiError);
  });
});
