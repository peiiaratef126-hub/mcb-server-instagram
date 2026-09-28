import { describe, it, expect } from "vitest";
import { searchHashtagTool, getHashtagMediaTool } from "./hashtags.js";
import { MockInstagramGraphProvider } from "../providers/mock-provider.js";

describe("Feature 13: Hashtag Search & Discovery Tools", () => {
  it("search_hashtag should resolve hashtag name to ID and include quota warning", async () => {
    const provider = new MockInstagramGraphProvider();
    const result = await searchHashtagTool.execute({ hashtag_name: "#nature" }, provider);

    expect(result.id).toBe("17843826142012345");
    expect(result.name).toBe("nature");
    expect(result.quota_notice).toContain("30 unique hashtags");
  });

  it("get_hashtag_media should return recent media for hashtag", async () => {
    const provider = new MockInstagramGraphProvider();
    const result = await getHashtagMediaTool.execute(
      { hashtag_id: "17843826142012345", media_type: "recent_media", limit: 10 },
      provider
    );

    expect(result.data).toBeDefined();
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0].id).toBe("17900000000000050");
    expect(result.data[0].caption).toContain("#nature");
    expect(result.security_warning).toContain("CRITICAL");
    expect(result.quota_notice).toContain("30 unique hashtags");
  });

  it("get_hashtag_media should return top media for hashtag", async () => {
    const provider = new MockInstagramGraphProvider();
    const result = await getHashtagMediaTool.execute(
      { hashtag_id: "17843826142012345", media_type: "top_media", limit: 10 },
      provider
    );

    expect(result.data).toBeDefined();
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0].id).toBe("17900000000000051");
    expect(result.data[0].like_count).toBe(9840);
    expect(result.security_warning).toContain("CRITICAL");
  });
});
