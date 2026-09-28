import { z } from "zod";
import { InstagramGraphProvider } from "../providers/types.js";
import { logger } from "../utils/logger.js";

export const DEFAULT_PROFILE_FIELDS = [
  "id",
  "username",
  "name",
  "biography",
  "profile_picture_url",
  "followers_count",
  "follows_count",
  "media_count",
  "website",
] as const;

export const GetProfileInfoInputSchema = z.object({
  account_id: z
    .string()
    .trim()
    .regex(/^\d+$/, "Instagram Account ID must be a numeric string")
    .optional()
    .describe("Optional Instagram Business Account ID. Defaults to the configured account."),
  fields: z
    .array(z.string().trim())
    .optional()
    .describe("Optional list of specific profile fields to retrieve."),
});

export type GetProfileInfoInput = z.infer<typeof GetProfileInfoInputSchema>;

export interface InstagramProfileData {
  id: string;
  username: string;
  name?: string;
  biography?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  website?: string;
}

export const getProfileInfoTool = {
  name: "get_profile_info",
  description:
    "Retrieve profile information for an Instagram Professional (Business/Creator) account including follower count, bio, and media count via official Meta Graph API.",
  inputSchema: GetProfileInfoInputSchema,
  execute: async (
    input: GetProfileInfoInput,
    provider: InstagramGraphProvider
  ): Promise<InstagramProfileData> => {
    const targetAccountId = input.account_id || (await provider.getAccountId());
    const fieldsToFetch =
      input.fields && input.fields.length > 0
        ? input.fields.join(",")
        : DEFAULT_PROFILE_FIELDS.join(",");

    logger.debug(`[get_profile_info] Fetching profile for account: ${targetAccountId}`);

    const result = await provider.get<InstagramProfileData>(targetAccountId, {
      params: { fields: fieldsToFetch },
    });

    return result;
  },
};
