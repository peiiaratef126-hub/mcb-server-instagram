"""Feature 22 — AI Caption & Hashtag Optimization.

Generates creative, high-converting Instagram captions in diverse tones
(professional, casual, humorous, promotional) and highly relevant hashtags,
respecting Meta's constraints (max 2,200 characters, max 30 hashtags).

STRICT RULE 4: Gated by user's ANTHROPIC_API_KEY. Disabled by default; if key is
not configured, returns an actionable configuration warning and graceful fallback.
"""

import json
import os
import re
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

DEFAULT_ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-3-5-haiku-20241022")

# Instagram limits
MAX_INSTAGRAM_CAPTION_CHARS = 2200
MAX_INSTAGRAM_HASHTAGS = 30

VALID_TONES = ("professional", "casual", "humorous", "promotional", "inspirational")

CAPTION_SYSTEM_PROMPT = """You are an elite Instagram copywriter and social media strategist.
Your task is to craft compelling, high-converting Instagram captions with high-relevance hashtags.

Guidelines:
1. First 1-2 lines must be an irresistible hook (before Instagram's "...more" cut-off).
2. Clean line breaks for readability.
3. Natural emoji usage matching the requested tone.
4. Clear Call to Action (CTA) matching the post intent.
5. Provide relevant hashtags categorized by broad, niche, and community/location.
6. NEVER exceed 30 hashtags (Meta hard limit).
7. If Arabic is requested or detected, generate authentic, modern Arabic copy (Modern Standard Arabic or regional dialect as appropriate).

Output STRICT JSON only, matching this exact schema:
{
  "caption": "The complete ready-to-post Instagram caption including hook, body, and CTA",
  "hook": "The first line / hook intended to stop the scroll",
  "call_to_action": "The specific call to action",
  "hashtags": ["#tag1", "#tag2", "#tag3"],
  "tone_applied": "professional" | "casual" | "humorous" | "promotional" | "inspirational",
  "language": "english" | "arabic" | "multilingual",
  "content_tips": "1-2 brief tactical tips for posting this specific content"
}
"""


class CaptionGenerationRequest(BaseModel):
    """Input parameters for generating an Instagram caption."""
    topic: str = Field(..., description="Post topic, concept, or description of media")
    tone: str = Field(default="casual", description="professional, casual, humorous, promotional, or inspirational")
    language: str = Field(default="auto", description="auto, english, or arabic")
    target_audience: Optional[str] = Field(default=None, description="Intended audience description")
    call_to_action: Optional[str] = Field(default=None, description="Custom CTA e.g. 'Link in bio'")
    max_hashtags: int = Field(default=15, ge=1, le=30, description="Max hashtags to generate (1-30)")
    include_emojis: bool = Field(default=True, description="Whether to include emojis")


class CaptionGenerationResult(BaseModel):
    """Result of AI caption and hashtag generation."""
    is_enabled: bool = True
    caption: str
    hook: Optional[str] = None
    call_to_action: Optional[str] = None
    hashtags: List[str] = Field(default_factory=list)
    full_text_with_hashtags: str
    tone_applied: str
    language: str
    character_count: int
    hashtag_count: int
    content_tips: Optional[str] = None
    error: Optional[str] = None


class CaptionGenerator:
    """Caption and hashtag optimization service powered by Claude API."""

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        self.model = model or DEFAULT_ANTHROPIC_MODEL
        self._client = None

    @property
    def is_configured(self) -> bool:
        """Check if Anthropic API key is configured."""
        return bool(self.api_key and self.api_key.strip())

    def _get_client(self):
        """Lazy initializer for Anthropic client."""
        if not self.is_configured:
            return None
        if self._client is None:
            import anthropic
            self._client = anthropic.Anthropic(api_key=self.api_key)
        return self._client

    def generate(
        self,
        request: CaptionGenerationRequest,
    ) -> CaptionGenerationResult:
        """Generates an optimized Instagram caption and hashtags based on input request."""
        tone = request.tone.lower() if request.tone.lower() in VALID_TONES else "casual"
        max_tags = min(max(request.max_hashtags, 1), MAX_INSTAGRAM_HASHTAGS)

        # STRICT RULE 4: Handle unconfigured API key gracefully
        if not self.is_configured:
            fallback_caption = (
                f"{request.topic}\n\n"
                f"{request.call_to_action or 'Double tap if you agree! 👇'}"
            )
            fallback_tags = [
                f"#{word.lower()}"
                for word in re.findall(r"\b\w{4,}\b", request.topic)[:max_tags]
            ]
            full_text = f"{fallback_caption}\n\n{' '.join(fallback_tags)}"

            return CaptionGenerationResult(
                is_enabled=False,
                caption=fallback_caption,
                hook=request.topic.split("\n")[0][:80],
                call_to_action=request.call_to_action or "Double tap if you agree! 👇",
                hashtags=fallback_tags,
                full_text_with_hashtags=full_text,
                tone_applied=tone,
                language=request.language,
                character_count=len(full_text),
                hashtag_count=len(fallback_tags),
                content_tips="AI generation is disabled: ANTHROPIC_API_KEY is not configured.",
                error="ANTHROPIC_API_KEY_NOT_CONFIGURED",
            )

        client = self._get_client()
        try:
            user_prompt = (
                f"Generate an Instagram caption for the following details:\n"
                f"- Topic/Description: {request.topic}\n"
                f"- Requested Tone: {tone}\n"
                f"- Language: {request.language}\n"
                f"- Target Audience: {request.target_audience or 'General Instagram audience'}\n"
                f"- Custom CTA: {request.call_to_action or 'Default engaging CTA'}\n"
                f"- Maximum Hashtags: {max_tags}\n"
                f"- Use Emojis: {'Yes' if request.include_emojis else 'No'}\n"
            )

            response = client.messages.create(
                model=self.model,
                max_tokens=600,
                system=CAPTION_SYSTEM_PROMPT,
                messages=[
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.7,
            )

            raw_output = response.content[0].text.strip()

            # Parse JSON
            json_match = re.search(r"\{.*\}", raw_output, re.DOTALL)
            if json_match:
                parsed = json.loads(json_match.group(0))
            else:
                parsed = json.loads(raw_output)

            caption = str(parsed.get("caption", request.topic))
            hook = parsed.get("hook")
            cta = parsed.get("call_to_action")
            raw_tags = parsed.get("hashtags", [])

            # Clean and sanitize hashtags
            sanitized_tags: List[str] = []
            for tag in raw_tags:
                clean_tag = tag.strip()
                if not clean_tag.startswith("#"):
                    clean_tag = f"#{clean_tag}"
                # Remove spaces inside hashtags
                clean_tag = re.sub(r"\s+", "", clean_tag)
                if clean_tag not in sanitized_tags and len(clean_tag) > 1:
                    sanitized_tags.append(clean_tag)
                if len(sanitized_tags) >= max_tags:
                    break

            tags_string = " ".join(sanitized_tags)
            full_text = f"{caption}\n\n{tags_string}".strip()

            # Truncate if somehow exceeds Instagram 2200 char limit
            if len(full_text) > MAX_INSTAGRAM_CAPTION_CHARS:
                caption = caption[: MAX_INSTAGRAM_CAPTION_CHARS - len(tags_string) - 5] + "..."
                full_text = f"{caption}\n\n{tags_string}".strip()

            return CaptionGenerationResult(
                is_enabled=True,
                caption=caption,
                hook=hook,
                call_to_action=cta,
                hashtags=sanitized_tags,
                full_text_with_hashtags=full_text,
                tone_applied=str(parsed.get("tone_applied", tone)),
                language=str(parsed.get("language", request.language)),
                character_count=len(full_text),
                hashtag_count=len(sanitized_tags),
                content_tips=parsed.get("content_tips"),
            )

        except Exception as e:
            fallback = f"{request.topic}\n\n{request.call_to_action or ''}"
            return CaptionGenerationResult(
                is_enabled=True,
                caption=fallback,
                hook=request.topic[:80],
                call_to_action=request.call_to_action,
                hashtags=[],
                full_text_with_hashtags=fallback,
                tone_applied=tone,
                language=request.language,
                character_count=len(fallback),
                hashtag_count=0,
                error=f"API_ERROR: {str(e)}",
                content_tips="Caption generation encountered an API error. Check quota or network.",
            )
