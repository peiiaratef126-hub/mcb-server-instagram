import { InstagramGraphProvider, RequestOptions } from "./types.js";
import { InstagramApiError } from "../errors/index.js";

/**
 * Hand-written mock fixtures modeled precisely on official Meta Graph API v21.0 responses (Rule 7).
 */
export const FIXTURES = {
  profile: {
    id: "17841400000000000",
    username: "official_brand_test",
    name: "Official Brand Co.",
    biography: "Automating Instagram with official Meta Graph APIs & Model Context Protocol.",
    profile_picture_url: "https://scontent.cdninstagram.com/v/t51.2885-19/sample_avatar.jpg",
    followers_count: 15420,
    follows_count: 412,
    media_count: 98,
  },
  mediaList: {
    data: [
      {
        id: "17900000000000001",
        caption: "Exciting new announcement! Official MCP server is live. #ai #mcp",
        media_type: "IMAGE",
        media_url: "https://scontent.cdninstagram.com/v/sample_img1.jpg",
        permalink: "https://www.instagram.com/p/DA123456789/",
        timestamp: "2026-09-25T14:00:00+0000",
        like_count: 420,
        comments_count: 35,
      },
      {
        id: "17900000000000002",
        caption: "Behind the scenes reel showing AI workflows in action.",
        media_type: "VIDEO",
        media_url: "https://video.cdninstagram.com/v/sample_reel1.mp4",
        permalink: "https://www.instagram.com/reel/DA987654321/",
        timestamp: "2026-09-26T18:30:00+0000",
        like_count: 1250,
        comments_count: 94,
      },
    ],
    paging: {
      cursors: {
        before: "QVFIUl9...",
        after: "QVFIUmB...",
      },
    },
  },
  comments: {
    data: [
      {
        id: "17988888888888881",
        text: "This architecture is super clean! Two-step confirmation is essential.",
        timestamp: "2026-09-25T14:20:00+0000",
        username: "developer_fan",
        like_count: 12,
        hidden: false,
      },
      {
        id: "17988888888888882",
        text: "Can I connect my creator account too?",
        timestamp: "2026-09-25T15:10:00+0000",
        username: "content_creator_1",
        like_count: 2,
        hidden: false,
      },
    ],
  },
  accountInsights: {
    data: [
      {
        name: "impressions",
        period: "day",
        values: [{ value: 4320, end_time: "2026-09-27T07:00:00+0000" }],
        title: "Impressions",
        description: "Total count of views across all media",
        id: "17841400000000000/insights/impressions/day",
      },
      {
        name: "reach",
        period: "day",
        values: [{ value: 3105, end_time: "2026-09-27T07:00:00+0000" }],
        title: "Reach",
        description: "Total unique accounts that viewed your media",
        id: "17841400000000000/insights/reach/day",
      },
    ],
  },
  postInsights: {
    data: [
      {
        name: "reach",
        period: "lifetime",
        values: [{ value: 2450 }],
        title: "Reach",
        description: "Total unique accounts that saw this post",
        id: "17900000000000001/insights/reach/lifetime",
      },
      {
        name: "saved",
        period: "lifetime",
        values: [{ value: 89 }],
        title: "Saved",
        description: "Total saves on this post",
        id: "17900000000000001/insights/saved/lifetime",
      },
    ],
  },
  replyCommentResponse: {
    id: "17999999999999999",
  },
  deleteResponse: {
    success: true,
  },
  tags: {
    data: [
      {
        id: "17900000000000009",
        caption: "Loved collaborating with @official_brand_test on this!",
        media_type: "IMAGE",
        media_url: "https://scontent.cdninstagram.com/v/sample_tagged.jpg",
        permalink: "https://www.instagram.com/p/DA999999999/",
        timestamp: "2026-09-27T10:00:00+0000",
        username: "partner_brand",
        like_count: 85,
        comments_count: 14,
      },
    ],
  },
  mentions: {
    mentioned_comment: {
      id: "17988888888888899",
      text: "Hey @official_brand_test check your DM please!",
      timestamp: "2026-09-27T11:00:00+0000",
      media: { id: "17900000000000001" },
    },
    mentioned_media: {
      id: "17900000000000009",
      caption: "Shoutout to @official_brand_test!",
      media_type: "IMAGE",
      permalink: "https://www.instagram.com/p/DA999999999/",
      timestamp: "2026-09-27T10:00:00+0000",
    },
  },
  conversations: {
    data: [
      {
        id: "t_17841411111111111",
        updated_time: "2026-09-27T12:00:00+0000",
        participants: {
          data: [
            { id: "17841411111111111", username: "fan_customer" },
            { id: "17841400000000000", username: "official_brand_test" },
          ],
        },
      },
    ],
  },
  conversationMessages: {
    data: [
      {
        id: "m_msg12345",
        created_time: "2026-09-27T12:00:00+0000",
        from: { id: "17841411111111111", username: "fan_customer" },
        to: { data: [{ id: "17841400000000000", username: "official_brand_test" }] },
        message: "Hello! Do you ship internationally?",
      },
    ],
  },
  sendMessageResponse: {
    recipient_id: "17841411111111111",
    message_id: "m_msg_sent_9999",
  },
};

export class MockInstagramGraphProvider implements InstagramGraphProvider {
  public readonly name = "mock-graph";
  public customResponses: Map<string, unknown> = new Map();
  public callHistory: Array<{ method: string; endpoint: string; body?: unknown; options?: RequestOptions }> = [];

  constructor(
    private readonly accountId: string = "17841400000000000",
    private readonly accessToken: string = "EAAG_mock_valid_access_token_fixture_12345"
  ) {}

  public async getAccessToken(): Promise<string> {
    return this.accessToken;
  }

  public async getAccountId(): Promise<string> {
    return this.accountId;
  }

  public setMockResponse(path: string, response: unknown): void {
    this.customResponses.set(path, response);
  }

  public async get<T = unknown>(endpoint: string, options?: RequestOptions): Promise<T> {
    this.callHistory.push({ method: "GET", endpoint, options });

    if (this.customResponses.has(endpoint)) {
      return this.customResponses.get(endpoint) as T;
    }

    const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;

    // Match mentions
    if (cleanEndpoint === this.accountId && options?.params?.fields && String(options.params.fields).includes("mentioned_")) {
      return FIXTURES.mentions as T;
    }

    // Match account profile
    if (cleanEndpoint === this.accountId || cleanEndpoint === "me") {
      return FIXTURES.profile as T;
    }

    // Match media list
    if (cleanEndpoint === `${this.accountId}/media`) {
      return FIXTURES.mediaList as T;
    }

    // Match post details
    if (cleanEndpoint === "17900000000000001") {
      return FIXTURES.mediaList.data[0] as T;
    }

    // Match comments
    if (cleanEndpoint.endsWith("/comments")) {
      return FIXTURES.comments as T;
    }

    // Match account insights
    if (cleanEndpoint === `${this.accountId}/insights`) {
      return FIXTURES.accountInsights as T;
    }

    // Match post insights
    if (cleanEndpoint.startsWith("17900000000000001/insights")) {
      return FIXTURES.postInsights as T;
    }

    // Match tags
    if (cleanEndpoint === `${this.accountId}/tags` || cleanEndpoint.endsWith("/tags")) {
      return FIXTURES.tags as T;
    }

    // Match mentions
    if (cleanEndpoint === this.accountId && options?.params?.fields && String(options.params.fields).includes("mentioned_")) {
      return FIXTURES.mentions as T;
    }

    // Match conversations
    if (cleanEndpoint === `${this.accountId}/conversations` || cleanEndpoint.endsWith("/conversations")) {
      return FIXTURES.conversations as T;
    }

    // Match conversation messages
    if (cleanEndpoint.includes("/messages")) {
      return FIXTURES.conversationMessages as T;
    }

    throw new InstagramApiError(`Mock endpoint not found: ${endpoint}`, { status: 404, code: 803 });
  }

  public async post<T = unknown>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    this.callHistory.push({ method: "POST", endpoint, body, options });

    if (this.customResponses.has(endpoint)) {
      return this.customResponses.get(endpoint) as T;
    }

    if (endpoint.includes("/comments")) {
      return FIXTURES.replyCommentResponse as T;
    }

    if (endpoint.includes("/messages")) {
      return FIXTURES.sendMessageResponse as T;
    }

    return { success: true, id: "17999999999999999" } as T;
  }

  public async delete<T = unknown>(endpoint: string, options?: RequestOptions): Promise<T> {
    this.callHistory.push({ method: "DELETE", endpoint, options });

    if (this.customResponses.has(endpoint)) {
      return this.customResponses.get(endpoint) as T;
    }

    return FIXTURES.deleteResponse as T;
  }
}
