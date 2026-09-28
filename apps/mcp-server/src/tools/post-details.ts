import { z } from "zod";
import { InstagramGraphProvider } from "../providers/types.js";
import { logger } from "../utils/logger.js";

export const DEFAULT_POST_DETAIL_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_url",
  "permalink",
  "thumbnail_url",
  "timestamp",
  "like_count",
  "comments_count",
  "children{id,media_type,media_url,permalink}",
] as const;

export const GetPostDetailsInputSchema = z.object({
  media_id: z
    .string()
    .trim()
    .min(1, "media_id is required")
    .describe("Instagram Media ID of the post to retrieve."),
  fields: z
    .array(z.string().trim())
    .optional()
    .describe("Optional list of specific fields to retrieve on the media object."),
});

export type GetPostDetailsInput = z.infer<typeof GetPostDetailsInputSchema>;

export interface PostChildItem {
  id: string;
  media_type: "IMAGE" | "VIDEO";
  media_url?: string;
  permalink?: string;
}

export interface PostDetailsData {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string;
  permalink?: string;
  thumbnail_url?: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
  children?: {
    data: PostChildItem[];
  };
}

export const getPostDetailsTool = {
  name: "get_post_details",
  description:
    "Retrieve comprehensive details for a specific Instagram post by ID, including captions, metrics, and carousel children.",
  inputSchema: GetPostDetailsInputSchema,
  execute: async (
    input: GetPostDetailsInput,
    provider: InstagramGraphProvider
  ): Promise<PostDetailsData> => {
    const fieldsToFetch =
      input.fields && input.fields.length > 0
        ? input.fields.join(",")
        : DEFAULT_POST_DETAIL_FIELDS.join(",");

    logger.debug(`[get_post_details] Fetching post details for media_id: ${input.media_id}`);

    const result = await provider.get<PostDetailsData>(input.media_id, {
      params: { fields: fieldsToFetch },
    });

    return result;
  },
};
