import { describe, it, expect } from "vitest";
import { getPostDetailsTool } from "./post-details.js";
import { MockInstagramGraphProvider, FIXTURES } from "../providers/mock-provider.js";

describe("Feature 3: Post Details Tool (get_post_details)", () => {
  it("should fetch details for a specific post using default fields", async () => {
    const mockProvider = new MockInstagramGraphProvider();

    const post = await getPostDetailsTool.execute(
      { media_id: "17900000000000001" },
      mockProvider
    );

    expect(post.id).toBe("17900000000000001");
    expect(post.caption).toContain("Exciting new announcement");
    expect(mockProvider.callHistory[0].endpoint).toBe("17900000000000001");
    expect(mockProvider.callHistory[0].options?.params?.fields).toContain("children");
  });

  it("should fetch post with carousel children", async () => {
    const mockProvider = new MockInstagramGraphProvider();
    mockProvider.setMockResponse("17900000000000099", {
      id: "17900000000000099",
      media_type: "CAROUSEL_ALBUM",
      caption: "Carousel sample post",
      timestamp: "2026-09-27T10:00:00+0000",
      children: {
        data: [
          { id: "17900000000000100", media_type: "IMAGE", media_url: "https://example.com/c1.jpg" },
          { id: "17900000000000101", media_type: "IMAGE", media_url: "https://example.com/c2.jpg" },
        ],
      },
    });

    const post = await getPostDetailsTool.execute(
      { media_id: "17900000000000099" },
      mockProvider
    );

    expect(post.media_type).toBe("CAROUSEL_ALBUM");
    expect(post.children?.data).toHaveLength(2);
  });
});
