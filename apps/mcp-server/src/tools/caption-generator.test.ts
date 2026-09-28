import { describe, it, expect } from "vitest";
import {
  generateCaptionAndHashtags,
  GenerateCaptionInput,
} from "./caption-generator.js";

describe("Feature 22: AI Caption and Hashtag Generator Tool", () => {
  it("returns fallback with notification when ANTHROPIC_API_KEY is not configured", async () => {
    const input: GenerateCaptionInput = {
      topic: "Launch of handcrafted ceramic cups",
      tone: "promotional",
      language: "english",
      max_hashtags: 5,
      include_emojis: true,
    };

    const result = await generateCaptionAndHashtags(input, undefined, "");
    expect(result.is_enabled).toBe(false);
    expect(result.error).toBe("ANTHROPIC_API_KEY_NOT_CONFIGURED");
    expect(result.caption).toContain("handcrafted ceramic cups");
    expect(result.hashtags.length).toBeLessThanOrEqual(5);
  });

  it("generates structured caption with hook, CTA, and hashtags via mock fetcher", async () => {
    const mockFetcher = async () =>
      JSON.stringify({
        caption: "Never drink cold coffee again! ☕ Meet our artisan thermal mugs.\n\nCrafted for perfection.",
        hook: "Never drink cold coffee again! ☕",
        call_to_action: "Link in bio to shop the limited drop!",
        hashtags: ["#artisan", "#coffeetime", "#ceramics"],
        tone_applied: "promotional",
        language: "english",
        content_tips: "Post behind-the-scenes video on Stories.",
      });

    const input: GenerateCaptionInput = {
      topic: "Artisan thermal mugs drop",
      tone: "promotional",
      language: "english",
      max_hashtags: 10,
      include_emojis: true,
    };

    const result = await generateCaptionAndHashtags(input, mockFetcher, "sk-mock-key");
    expect(result.is_enabled).toBe(true);
    expect(result.hook).toBe("Never drink cold coffee again! ☕");
    expect(result.call_to_action).toBe("Link in bio to shop the limited drop!");
    expect(result.hashtags).toEqual(["#artisan", "#coffeetime", "#ceramics"]);
    expect(result.full_text_with_hashtags).toContain("#ceramics");
  });

  it("clamps hashtag requests to Meta maximum of 30", async () => {
    const mockFetcher = async () => {
      const tags = Array.from({ length: 40 }, (_, i) => `#tag${i}`);
      return JSON.stringify({
        caption: "Test caption",
        hashtags: tags,
      });
    };

    const input: GenerateCaptionInput = {
      topic: "Clamping test",
      tone: "casual",
      language: "english",
      max_hashtags: 30,
      include_emojis: false,
    };

    const result = await generateCaptionAndHashtags(input, mockFetcher, "sk-mock-key");
    expect(result.hashtags.length).toBeLessThanOrEqual(30);
  });

  it("handles fetcher errors gracefully without throwing unhandled exceptions", async () => {
    const failingFetcher = async () => {
      throw new Error("Anthropic 503 Service Unavailable");
    };

    const input: GenerateCaptionInput = {
      topic: "Any topic",
      tone: "casual",
      language: "english",
      max_hashtags: 10,
      include_emojis: true,
    };

    const result = await generateCaptionAndHashtags(input, failingFetcher, "sk-mock-key");
    expect(result.is_enabled).toBe(true);
    expect(result.error).toContain("API_ERROR");
    expect(result.caption).toContain("Any topic");
  });
});
