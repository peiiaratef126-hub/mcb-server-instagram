import { describe, it, expect } from "vitest";
import { MockInstagramGraphProvider } from "../providers/mock-provider.js";
import {
  analyzeCommentSentiment,
  analyzeCommentSentimentTool,
  AnalyzeCommentSentimentInput,
} from "./comment-sentiment.js";

describe("Feature 24: Comment Sentiment Analysis Tool", () => {
  it("returns actionable warning when ANTHROPIC_API_KEY is not configured", async () => {
    const input: AnalyzeCommentSentimentInput = {
      comment_text: "Great experience with your store!",
    };
    const result = await analyzeCommentSentiment(input, undefined, "");

    expect(result.is_enabled).toBe(false);
    expect(result.sentiment).toBe("unknown");
    expect(result.error).toBe("ANTHROPIC_API_KEY_NOT_CONFIGURED");
    expect(result.reasoning).toContain("ANTHROPIC_API_KEY is not configured");
  });

  it("classifies Egyptian dialect compliment using injected fetcher", async () => {
    const mockFetcher = async () =>
      JSON.stringify({
        sentiment: "positive",
        confidence: 0.96,
        language_or_dialect: "arabic_egyptian",
        urgency_score: 0.05,
        requires_immediate_action: false,
        reasoning: "Customer praises the product enthusiastically in Egyptian dialect.",
        suggested_action: "Reply with gratitude",
      });

    const input: AnalyzeCommentSentimentInput = {
      comment_id: "c_eg_1",
      comment_text: "المنتج ده تحفة وعاش جداً",
    };
    const result = await analyzeCommentSentiment(input, mockFetcher, "sk-mock-key");

    expect(result.is_enabled).toBe(true);
    expect(result.sentiment).toBe("positive");
    expect(result.language_or_dialect).toBe("arabic_egyptian");
    expect(result.requires_immediate_action).toBe(false);
    expect(result.confidence).toBe(0.96);
  });

  it("classifies Gulf dialect urgent customer crisis with escalation flag", async () => {
    const mockFetcher = async () =>
      JSON.stringify({
        sentiment: "urgent",
        confidence: 0.99,
        language_or_dialect: "arabic_gulf",
        urgency_score: 0.95,
        requires_immediate_action: true,
        reasoning: "Severe complaint regarding missing paid order with accusations of fraud.",
        suggested_action: "Escalate to high-priority customer care immediately.",
      });

    const input: AnalyzeCommentSentimentInput = {
      comment_text: "وين طلبي صارلي اسبوعين دافع وما وصل! نصابين ردوا علي بالخاص",
    };
    const result = await analyzeCommentSentiment(input, mockFetcher, "sk-mock-key");

    expect(result.is_enabled).toBe(true);
    expect(result.sentiment).toBe("urgent");
    expect(result.requires_immediate_action).toBe(true);
    expect(result.urgency_score).toBeGreaterThanOrEqual(0.9);
  });

  it("handles fetcher errors gracefully without throwing unhandled exceptions", async () => {
    const failingFetcher = async () => {
      throw new Error("API rate limit exceeded");
    };

    const input: AnalyzeCommentSentimentInput = {
      comment_text: "Nice post!",
    };
    const result = await analyzeCommentSentiment(input, failingFetcher, "sk-mock-key");

    expect(result.is_enabled).toBe(true);
    expect(result.sentiment).toBe("unknown");
    expect(result.error).toContain("API_ERROR");
  });
});
