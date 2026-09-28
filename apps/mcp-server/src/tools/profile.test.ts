import { describe, it, expect } from "vitest";
import { getProfileInfoTool } from "./profile.js";
import { MockInstagramGraphProvider, FIXTURES } from "../providers/mock-provider.js";

describe("Feature 1: Profile Info Tool (get_profile_info)", () => {
  it("should fetch default profile information using provider account ID", async () => {
    const mockProvider = new MockInstagramGraphProvider();

    const profile = await getProfileInfoTool.execute({}, mockProvider);

    expect(profile).toEqual(FIXTURES.profile);
    expect(mockProvider.callHistory).toHaveLength(1);
    expect(mockProvider.callHistory[0].endpoint).toBe("17841400000000000");
    expect(mockProvider.callHistory[0].options?.params?.fields).toContain("username");
    expect(mockProvider.callHistory[0].options?.params?.fields).toContain("followers_count");
  });

  it("should allow querying a specific account ID and custom fields", async () => {
    const mockProvider = new MockInstagramGraphProvider();
    mockProvider.setMockResponse("17841999999999999", {
      id: "17841999999999999",
      username: "partner_account",
      followers_count: 50000,
    });

    const profile = await getProfileInfoTool.execute(
      {
        account_id: "17841999999999999",
        fields: ["id", "username", "followers_count"],
      },
      mockProvider
    );

    expect(profile.username).toBe("partner_account");
    expect(profile.followers_count).toBe(50000);
    expect(mockProvider.callHistory[0].endpoint).toBe("17841999999999999");
    expect(mockProvider.callHistory[0].options?.params?.fields).toBe("id,username,followers_count");
  });
});
