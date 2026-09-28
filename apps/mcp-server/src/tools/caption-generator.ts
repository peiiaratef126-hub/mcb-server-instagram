import { z } from "zod";
import { InstagramGraphProvider } from "../providers/types.js";
import { logger } from "../utils/logger.js";

export const MAX_INSTAGRAM_CAPTION_CHARS = 2200;
export const MAX_INSTAGRAM_HASHTAGS = 30;

export const GenerateCaptionInputSchema = z.object({
  topic: z
    .string()
    .trim()
    .min(1, "Topic or media description cannot be empty")
    .describe("Post topic, concept, or description of the media."),
  tone: z
    .enum(["professional", "casual", "humorous", "promotional", "inspirational"])
    .default("casual")
    .describe("Tone of voice for the caption ('professional', 'casual', 'humorous', 'promotional', 'inspirational')."),
  language: z
    .enum(["auto", "english", "arabic"])
    .default("auto")
    .describe("Language for the caption ('auto', 'english', or 'arabic')."),
  target_audience: z
    .string()
    .trim()
    .optional()
    .describe("Target audience description (e.g. 'small business owners in the UAE')."),
  call_to_action: z
    .string()
    .trim()
    .optional()
    .describe("Custom call to action (e.g. 'Click link in bio', 'Comment below')."),
  max_hashtags: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(15)
    .describe("Maximum number of relevant hashtags to generate (1-30)."),
  include_emojis: z
    .boolean()
    .default(true)
    .describe("Whether to include natural emojis in caption."),
});

export type GenerateCaptionInput = z.infer<typeof GenerateCaptionInputSchema>;

export interface GenerateCaptionOutput {
  is_enabled: boolean;
  caption: string;
  hook?: string;
  call_to_action?: string;
  hashtags: string[];
  full_text_with_hashtags: string;
  tone_applied: string;
  language: string;
  character_count: number;
  hashtag_count: number;
  content_tips?: string;
  error?: string;
}

export const CAPTION_SYSTEM_PROMPT = `You are an elite Instagram copywriter and social media strategist.
Craft compelling, high-converting Instagram captions with high-relevance hashtags.

Guidelines:
1. Hook: First 1-2 lines must stop the scroll before the "...more" cut-off.
2. Clean formatting with natural line breaks.
3. Relevant emojis matching tone.
4. Clear call to action (CTA).
5. Categorized hashtags (niche, broad, community).
6. Maximum 30 hashtags (Meta limit).
7. Authentic phrasing if Arabic is requested.

Output STRICT JSON only:
{
  "caption": "complete formatted caption",
  "hook": "first hook line",
  "call_to_action": "specific CTA",
  "hashtags": ["#tag1", "#tag2"],
  "tone_applied": "professional" | "casual" | "humorous" | "promotional" | "inspirational",
  "language": "english" | "arabic",
  "content_tips": "tactical posting advice"
}`;

export type CaptionAnthropicFetcher = (
  prompt: string,
  systemPrompt: string,
  apiKey: string
) => Promise<string>;

export const defaultCaptionFetcher: CaptionAnthropicFetcher = async (
  prompt: string,
  systemPrompt: string,
  apiKey: string
): Promise<string> => {
  const model = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-20241022";
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    }),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`Anthropic API returned HTTP ${resp.status}: ${errorText}`);
  }

  const data = (await resp.json()) as { content: Array<{ type: string; text: string }> };
  return data.content[0]?.text || "{}";
};

export async function generateCaptionAndHashtags(
  input: GenerateCaptionInput,
  fetcher: CaptionAnthropicFetcher = defaultCaptionFetcher,
  explicitApiKey?: string
): Promise<GenerateCaptionOutput> {
  const apiKey = explicitApiKey || process.env.ANTHROPIC_API_KEY;
  const maxTags = Math.min(Math.max(input.max_hashtags, 1), MAX_INSTAGRAM_HASHTAGS);

  // STRICT RULE 4: Fallback if API key is missing
  if (!apiKey || !apiKey.trim()) {
    const fallbackCaption = `${input.topic}\n\n${input.call_to_action || "Save this post for later! 📌"}`;
    const words = input.topic.match(/\b\w{4,}\b/g) || [];
    const fallbackTags = words.slice(0, maxTags).map((w) => `#${w.toLowerCase()}`);
    const fullText = `${fallbackCaption}\n\n${fallbackTags.join(" ")}`.trim();

    return {
      is_enabled: false,
      caption: fallbackCaption,
      hook: input.topic.split("\n")[0].slice(0, 80),
      call_to_action: input.call_to_action || "Save this post for later! 📌",
      hashtags: fallbackTags,
      full_text_with_hashtags: fullText,
      tone_applied: input.tone,
      language: input.language,
      character_count: fullText.length,
      hashtag_count: fallbackTags.length,
      content_tips: "AI caption generator is disabled: ANTHROPIC_API_KEY is not configured.",
      error: "ANTHROPIC_API_KEY_NOT_CONFIGURED",
    };
  }

  try {
    const prompt = `Generate an Instagram caption for:
- Topic: ${input.topic}
- Tone: ${input.tone}
- Language: ${input.language}
- Audience: ${input.target_audience || "General audience"}
- CTA: ${input.call_to_action || "Engaging CTA"}
- Max Hashtags: ${maxTags}
- Use Emojis: ${input.include_emojis ? "Yes" : "No"}`;

    const rawOutput = await fetcher(prompt, CAPTION_SYSTEM_PROMPT, apiKey);
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(rawOutput);

    const caption = String(parsed.caption || input.topic);
    const hook = parsed.hook;
    const cta = parsed.call_to_action;
    const rawTags: string[] = Array.isArray(parsed.hashtags) ? parsed.hashtags : [];

    const sanitizedTags: string[] = [];
    for (const tag of rawTags) {
      let clean = String(tag).trim();
      if (!clean.startsWith("#")) clean = `#${clean}`;
      clean = clean.replace(/\s+/g, "");
      if (!sanitizedTags.includes(clean) && clean.length > 1) {
        sanitizedTags.push(clean);
      }
      if (sanitizedTags.length >= maxTags) break;
    }

    const tagStr = sanitizedTags.join(" ");
    let fullText = `${caption}\n\n${tagStr}`.trim();

    if (fullText.length > MAX_INSTAGRAM_CAPTION_CHARS) {
      const available = MAX_INSTAGRAM_CAPTION_CHARS - tagStr.length - 5;
      fullText = `${caption.slice(0, available)}...\n\n${tagStr}`.trim();
    }

    return {
      is_enabled: true,
      caption,
      hook,
      call_to_action: cta,
      hashtags: sanitizedTags,
      full_text_with_hashtags: fullText,
      tone_applied: String(parsed.tone_applied || input.tone),
      language: String(parsed.language || input.language),
      character_count: fullText.length,
      hashtag_count: sanitizedTags.length,
      content_tips: parsed.content_tips,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[generate_caption_and_hashtags] Error generating caption: ${msg}`);

    const fallback = `${input.topic}\n\n${input.call_to_action || ""}`;
    return {
      is_enabled: true,
      caption: fallback,
      hook: input.topic.slice(0, 80),
      call_to_action: input.call_to_action,
      hashtags: [],
      full_text_with_hashtags: fallback,
      tone_applied: input.tone,
      language: input.language,
      character_count: fallback.length,
      hashtag_count: 0,
      error: `API_ERROR: ${msg}`,
      content_tips: "Generation failed. Verify API quota or network connection.",
    };
  }
}

export const generateCaptionAndHashtagsTool = {
  name: "generate_caption_and_hashtags",
  description:
    "Generate engaging, high-converting Instagram captions and high-relevance hashtags in diverse tones (professional, casual, humorous, promotional, inspirational). Gated by ANTHROPIC_API_KEY.",
  inputSchema: GenerateCaptionInputSchema,
  execute: async (
    rawInput: GenerateCaptionInput,
    _provider: InstagramGraphProvider
  ): Promise<GenerateCaptionOutput> => {
    const input = GenerateCaptionInputSchema.parse(rawInput);
    return generateCaptionAndHashtags(input);
  },
};
