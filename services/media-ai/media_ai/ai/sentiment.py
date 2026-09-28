"""Feature 24 — Comment Sentiment Analysis with Arabic Dialect Support.

Analyzes Instagram comments to classify sentiment into positive, neutral, negative,
or urgent (escalations/customer support crises), with dedicated prompt engineering
for Modern Standard Arabic and regional Arabic dialects (Egyptian, Gulf, Levantine,
North African/Maghrebi) as well as English.

STRICT RULE 4: Gated by user's ANTHROPIC_API_KEY. Disabled by default; if key is
not configured, returns an actionable configuration warning without failing.
"""

import json
import os
import re
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

# Supported sentiment categories
SENTIMENT_POSITIVE = "positive"
SENTIMENT_NEUTRAL = "neutral"
SENTIMENT_NEGATIVE = "negative"
SENTIMENT_URGENT = "urgent"

DEFAULT_ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-3-5-haiku-20241022")

SENTIMENT_SYSTEM_PROMPT = """You are an expert Instagram sentiment and engagement analyzer with native fluency in English, Modern Standard Arabic (فصحى), and all major regional Arabic dialects:
1. Egyptian (e.g. "حلو أوي", "مش شغال", "تحفة", "بكام", "زبالة", "يا ريت تردوا")
2. Gulf/Saudi/Emirati/Kuwaiti (e.g. "ما شاء الله يجنن", "خايس", "تكفون ردو", "وايد حلو", "بجم", "نصابين", "ما وصلني")
3. Levantine/Syrian/Lebanese/Jordanian (e.g. "كتير حلو", "مو ظابط", "شو هاد", "بدي استفسر", "ردوا عالخاص")
4. North African/Maghrebi/Moroccan/Algerian/Tunisian (e.g. "زوين بزاف", "ما عجبنيش", "علاش ما كتردوش", "خدمة عيانة")
5. Arabizi / Franco-Arab transliteration (e.g. "to7fa", "msh 7elw", "wain talabi", "3ash").

Analyze the provided Instagram comment text and categorize its sentiment:
- "positive": Compliments, praise, enthusiasm, gratitude, positive emojis.
- "neutral": Inquiries regarding price, stock, hours, simple questions, neutral mentions.
- "negative": Dissatisfaction, product critique, bad experience, negative feedback without immediate crisis.
- "urgent": Customer support crisis, delayed/lost paid orders, demands for immediate refund, fraud accusations, anger demanding escalation, threats of legal action or reporting.

Output STRICT JSON only, matching this exact schema:
{
  "sentiment": "positive" | "neutral" | "negative" | "urgent",
  "confidence": 0.0 to 1.0,
  "language_or_dialect": "arabic_egyptian" | "arabic_gulf" | "arabic_levantine" | "arabic_maghrebi" | "arabic_msa" | "english" | "multilingual" | "other",
  "urgency_score": 0.0 to 1.0,
  "requires_immediate_action": true | false,
  "reasoning": "brief explanation in English of why this sentiment was chosen",
  "suggested_action": "recommended customer response or triage action"
}
"""


class SentimentAnalysisResult(BaseModel):
    """Structured result of comment sentiment classification."""
    is_enabled: bool = True
    comment_id: Optional[str] = None
    comment_text: str
    sentiment: str = Field(..., description="'positive', 'neutral', 'negative', 'urgent', or 'unknown'")
    confidence: float = 0.0
    language_or_dialect: str = "unknown"
    urgency_score: float = 0.0
    requires_immediate_action: bool = False
    reasoning: str
    suggested_action: Optional[str] = None
    error: Optional[str] = None


class CommentSentimentAnalyzer:
    """Analyzer for Instagram comments powered by Anthropic Claude API."""

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

    def analyze_comment(
        self,
        comment_text: str,
        comment_id: Optional[str] = None,
    ) -> SentimentAnalysisResult:
        """Analyzes a single Instagram comment for sentiment and urgency.

        If ANTHROPIC_API_KEY is missing, gracefully returns an actionable warning
        without throwing an unhandled exception (per Rule 4).
        """
        cleaned_text = (comment_text or "").strip()
        if not cleaned_text:
            return SentimentAnalysisResult(
                is_enabled=self.is_configured,
                comment_id=comment_id,
                comment_text="",
                sentiment=SENTIMENT_NEUTRAL,
                confidence=1.0,
                language_or_dialect="empty",
                urgency_score=0.0,
                requires_immediate_action=False,
                reasoning="Empty comment text provided.",
                suggested_action="No action required for empty text.",
            )

        if not self.is_configured:
            return SentimentAnalysisResult(
                is_enabled=False,
                comment_id=comment_id,
                comment_text=cleaned_text,
                sentiment="unknown",
                confidence=0.0,
                language_or_dialect="unknown",
                urgency_score=0.0,
                requires_immediate_action=False,
                reasoning=(
                    "AI sentiment analysis is disabled. To enable this feature, provide your "
                    "Anthropic API key via the ANTHROPIC_API_KEY environment variable."
                ),
                error="ANTHROPIC_API_KEY_NOT_CONFIGURED",
                suggested_action="Configure ANTHROPIC_API_KEY in your environment to activate Claude-powered sentiment triage.",
            )

        client = self._get_client()
        try:
            prompt_content = f"Analyze this Instagram comment:\n\n\"{cleaned_text}\""

            response = client.messages.create(
                model=self.model,
                max_tokens=400,
                system=SENTIMENT_SYSTEM_PROMPT,
                messages=[
                    {"role": "user", "content": prompt_content}
                ],
                temperature=0.0,
            )

            # Extract response text
            raw_output = response.content[0].text.strip()

            # Parse JSON from response (strip markdown fences if present)
            json_match = re.search(r"\{.*\}", raw_output, re.DOTALL)
            if json_match:
                parsed = json.loads(json_match.group(0))
            else:
                parsed = json.loads(raw_output)

            sentiment = parsed.get("sentiment", SENTIMENT_NEUTRAL).lower()
            if sentiment not in (SENTIMENT_POSITIVE, SENTIMENT_NEUTRAL, SENTIMENT_NEGATIVE, SENTIMENT_URGENT):
                sentiment = SENTIMENT_NEUTRAL

            return SentimentAnalysisResult(
                is_enabled=True,
                comment_id=comment_id,
                comment_text=cleaned_text,
                sentiment=sentiment,
                confidence=float(parsed.get("confidence", 0.8)),
                language_or_dialect=str(parsed.get("language_or_dialect", "unknown")),
                urgency_score=float(parsed.get("urgency_score", 0.0)),
                requires_immediate_action=bool(parsed.get("requires_immediate_action", False)),
                reasoning=str(parsed.get("reasoning", "Analyzed via Claude API")),
                suggested_action=parsed.get("suggested_action"),
            )

        except Exception as e:
            return SentimentAnalysisResult(
                is_enabled=True,
                comment_id=comment_id,
                comment_text=cleaned_text,
                sentiment="unknown",
                confidence=0.0,
                language_or_dialect="unknown",
                urgency_score=0.0,
                requires_immediate_action=False,
                reasoning=f"Sentiment classification failed: {str(e)}",
                error=f"API_ERROR: {str(e)}",
                suggested_action="Check network connection or Anthropic quota.",
            )

    def analyze_batch(
        self,
        comments: List[Dict[str, str]],
    ) -> List[SentimentAnalysisResult]:
        """Analyzes a list of comments, each containing 'id' and 'text'."""
        results = []
        for c in comments:
            cid = c.get("id")
            text = c.get("text", "")
            results.append(self.analyze_comment(comment_text=text, comment_id=cid))
        return results
