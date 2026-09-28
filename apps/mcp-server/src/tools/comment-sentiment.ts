import { z } from "zod";
import { InstagramGraphProvider } from "../providers/types.js";
import { logger } from "../utils/logger.js";

export const AnalyzeCommentSentimentInputSchema = z.object({
  comment_text: z
    .string()
    .trim()
    .min(1, "Comment text cannot be empty")
    .describe("The text of the Instagram comment to analyze (supports English, MSA, and Arabic dialects)."),
  comment_id: z
    .string()
    .trim()
    .optional()
    .describe("Optional Instagram comment ID."),
});

export type AnalyzeCommentSentimentInput = z.infer<typeof AnalyzeCommentSentimentInputSchema>;

export interface SentimentAnalysisOutput {
  is_enabled: boolean;
  comment_id?: string;
  comment_text: string;
  sentiment: "positive" | "neutral" | "negative" | "urgent" | "unknown";
  confidence: number;
  language_or_dialect: string;
  urgency_score: number;
  requires_immediate_action: boolean;
  reasoning: string;
  suggested_action?: string;
  error?: string;
}

export const SENTIMENT_SYSTEM_PROMPT = `You are an expert Instagram sentiment and engagement analyzer with native fluency in English, Modern Standard Arabic (فصحى), and all major regional Arabic dialects:
1. Egyptian (e.g. "حلو أوي", "مش شغال", "تحفة", "بكام", "زبالة")
2. Gulf/Saudi/Emirati/Kuwaiti (e.g. "ما شاء الله يجنن", "خايس", "تكفون ردو", "وايد حلو", "بجم", "نصابين")
3. Levantine/Syrian/Lebanese/Jordanian (e.g. "كتير حلو", "مو ظابط", "شو هاد", "بدي استفسر")
4. North African/Maghrebi (e.g. "زوين بزاف", "ما عجبنيش", "علاش ما كتردوش")
5. Arabizi / Franco-Arab (e.g. "to7fa", "msh 7elw", "wain talabi").

Categorize sentiment into:
- "positive": Praise, compliments, positive reviews, appreciation.
- "neutral": Price/sizing inquiries, general questions, neutral remarks.
- "negative": Dissatisfaction, product complaints, criticism.
- "urgent": Customer service escalations, undelivered paid orders, fraud accusations, anger demanding refund.

Output STRICT JSON only:
{
  "sentiment": "positive" | "neutral" | "negative" | "urgent",
  "confidence": 0.0 to 1.0,
  "language_or_dialect": "arabic_egyptian" | "arabic_gulf" | "arabic_levantine" | "arabic_maghrebi" | "arabic_msa" | "english" | "other",
  "urgency_score": 0.0 to 1.0,
  "requires_immediate_action": true | false,
  "reasoning": "brief explanation",
  "suggested_action": "recommended response or triage"
}`;

export type AnthropicFetcher = (
  prompt: string,
  systemPrompt: string,
  apiKey: string
) => Promise<string>;

export const defaultAnthropicFetcher: AnthropicFetcher = async (
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
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.0,
    }),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`Anthropic API returned HTTP ${resp.status}: ${errorText}`);
  }

  const data = (await resp.json()) as { content: Array<{ type: string; text: string }> };
  return data.content[0]?.text || "{}";
};

export async function analyzeCommentSentiment(
  input: AnalyzeCommentSentimentInput,
  fetcher: AnthropicFetcher = defaultAnthropicFetcher,
  explicitApiKey?: string
): Promise<SentimentAnalysisOutput> {
  const apiKey = explicitApiKey || process.env.ANTHROPIC_API_KEY;

  // STRICT RULE 4: Disabled by default; if key is not configured, return actionable warning
  if (!apiKey || !apiKey.trim()) {
    return {
      is_enabled: false,
      comment_id: input.comment_id,
      comment_text: input.comment_text,
      sentiment: "unknown",
      confidence: 0.0,
      language_or_dialect: "unknown",
      urgency_score: 0.0,
      requires_immediate_action: false,
      reasoning:
        "AI sentiment analysis is disabled: ANTHROPIC_API_KEY is not configured in environment.",
      error: "ANTHROPIC_API_KEY_NOT_CONFIGURED",
      suggested_action:
        "Configure ANTHROPIC_API_KEY in your environment to activate Claude-powered sentiment triage.",
    };
  }

  try {
    const rawOutput = await fetcher(
      `Analyze this Instagram comment:\n\n"${input.comment_text}"`,
      SENTIMENT_SYSTEM_PROMPT,
      apiKey
    );

    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(rawOutput);

    const sentiment = ["positive", "neutral", "negative", "urgent"].includes(
      parsed.sentiment?.toLowerCase()
    )
      ? (parsed.sentiment.toLowerCase() as SentimentAnalysisOutput["sentiment"])
      : "neutral";

    return {
      is_enabled: true,
      comment_id: input.comment_id,
      comment_text: input.comment_text,
      sentiment,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.85,
      language_or_dialect: parsed.language_or_dialect || "unknown",
      urgency_score: typeof parsed.urgency_score === "number" ? parsed.urgency_score : 0.0,
      requires_immediate_action: Boolean(parsed.requires_immediate_action),
      reasoning: parsed.reasoning || "Sentiment analyzed via Claude API",
      suggested_action: parsed.suggested_action,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[analyze_comment_sentiment] Error executing sentiment analysis: ${msg}`);

    return {
      is_enabled: true,
      comment_id: input.comment_id,
      comment_text: input.comment_text,
      sentiment: "unknown",
      confidence: 0.0,
      language_or_dialect: "unknown",
      urgency_score: 0.0,
      requires_immediate_action: false,
      reasoning: `Analysis failed: ${msg}`,
      error: `API_ERROR: ${msg}`,
      suggested_action: "Verify API key quota or network connectivity.",
    };
  }
}

export const analyzeCommentSentimentTool = {
  name: "analyze_comment_sentiment",
  description:
    "Analyze sentiment of an Instagram comment with advanced Arabic dialect support (Egyptian, Gulf, Levantine, North African) and English. Identifies urgent customer support crises. Gated by ANTHROPIC_API_KEY.",
  inputSchema: AnalyzeCommentSentimentInputSchema,
  execute: async (
    rawInput: AnalyzeCommentSentimentInput,
    _provider: InstagramGraphProvider
  ): Promise<SentimentAnalysisOutput> => {
    const input = AnalyzeCommentSentimentInputSchema.parse(rawInput);
    return analyzeCommentSentiment(input);
  },
};
