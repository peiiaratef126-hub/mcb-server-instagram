import { describe, it, expect } from "vitest";
import { listCommentsTool } from "./list-comments.js";
import { MockInstagramGraphProvider, FIXTURES } from "../providers/mock-provider.js";

describe("Feature 7: List Comments Tool (list_comments)", () => {
  it("should fetch comments and include explicit security warning regarding untrusted data", async () => {
    const mockProvider = new MockInstagramGraphProvider();

    const result = await listCommentsTool.execute(
      { media_id: "17900000000000001" },
      mockProvider
    );

    expect(result.data).toHaveLength(2);
    expect(result.data[0].id).toBe("17988888888888881");
    expect(result.data[0].text).toContain("Two-step confirmation is essential");
    expect(result.security_warning).toContain("untrusted external user data");

    const lastCall = mockProvider.callHistory[0];
    expect(lastCall.endpoint).toBe("17900000000000001/comments");
    expect(lastCall.options?.params?.limit).toBe(25);
    expect(lastCall.options?.params?.fields).toContain("replies");
  });

  it("should pass pagination cursors to comments query", async () => {
    const mockProvider = new MockInstagramGraphProvider();

    await listCommentsTool.execute(
      {
        media_id: "17900000000000001",
        limit: 15,
        after: "NEXT_CURSOR_COMMENTS",
      },
      mockProvider
    );

    const call = mockProvider.callHistory[0];
    expect(call.options?.params?.limit).toBe(15);
    expect(call.options?.params?.after).toBe("NEXT_CURSOR_COMMENTS");
  });
});
