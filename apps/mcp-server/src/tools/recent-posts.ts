import { z } from "zod";
import { InstagramGraphProvider } from "../providers/types.js";
import { logger } from "../utils/logger.js";

export const DEFAULT_POST_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_url",
  "permalink",
  "thumbnail_url",
  "timestamp",
  "like_count",
  "comments_count",
] as const;

export const GetRecentPostsInputSchema = z.object({
  account_id: z
    .string()
    .trim()
    .regex(/^\d+$/, "Instagram Account ID must be a numeric string")
    .optional()
    .describe("Optional Instagram Business Account ID. Defaults to configured account."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(25)
    .describe("Number of posts to return (1-50, default: 25)."),
  after: z
    .string()
    .trim()
    .optional()
    .describe("Pagination cursor to retrieve the next page of posts."),
  before: z
    .string()
    .trim()
    .optional()
    .describe("Pagination cursor to retrieve the previous page of posts."),
});

export type GetRecentPostsInput = z.infer<typeof GetRecentPostsInputSchema>;

export interface InstagramMediaItem {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string;
  permalink?: string;
  thumbnail_url?: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
}

export interface RecentPostsResponse {
  data: InstagramMediaItem[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
    previous?: string;
  };
}

export const getRecentPostsTool = {
  name: "get_recent_posts",
  description:
    "Retrieve recent posts/media published by an Instagram Professional account with cursor-based pagination.",
  inputSchema: GetRecentPostsInputSchema,
  execute: async (
    input: GetRecentPostsInput,
    provider: InstagramGraphProvider
  ): Promise<RecentPostsResponse> => {
    const targetAccountId = input.account_id || (await provider.getAccountId());
    const limit = input.limit ?? 25;

    logger.debug(`[get_recent_posts] Fetching recent posts for account: ${targetAccountId}`, {
      limit,
      after: input.after,
      before: input.before,
    });

    const params: Record<string, string | number | boolean | undefined> = {
      fields: DEFAULT_POST_FIELDS.join(","),
      limit,
    };

    if (input.after) {
      params.after = input.after;
    }
    if (input.before) {
      params.before = input.before;
    }

    const endpoint = `${targetAccountId}/media`;
    const response = await provider.get<RecentPostsResponse>(endpoint, { params });
    return response;
  },
};
