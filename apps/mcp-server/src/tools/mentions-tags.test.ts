import { describe, it, expect } from "vitest";
import { getUserTagsTool, getMentionsTool } from "./mentions-tags.js";
import { MockInstagramGraphProvider } from "../providers/mock-provider.js";

describe("Feature 12: Mentions & Tags Read Tools", () => {
  it("get_user_tags should retrieve tagged media with untrusted data isolation warning", async () => {
    const provider = new MockInstagramGraphProvider();
    const result = await getUserTagsTool.execute({ limit: 10 }, provider);

    expect(result.data).toBeDefined();
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0].id).toBe("17900000000000009");
    expect(result.data[0].caption).toContain("@official_brand_test");
    expect(result.security_warning).toContain("CRITICAL");
  });

  it("get_mentions should retrieve mentioned comment and media with untrusted data isolation warning", async () => {
    const provider = new MockInstagramGraphProvider();
    const result = await getMentionsTool.execute(
      { comment_id: "17988888888888899", media_id: "17900000000000009" },
      provider
    );

    expect(result.mentioned_comment).toBeDefined();
    expect(result.mentioned_comment?.text).toBe("Hey @official_brand_test check your DM please!");
    expect(result.mentioned_media).toBeDefined();
    expect(result.mentioned_media?.caption).toBe("Shoutout to @official_brand_test!");
    expect(result.security_warning).toContain("CRITICAL");
  });
});
