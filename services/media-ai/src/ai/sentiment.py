"""Bridge export for services/media-ai/src/ai/sentiment.py."""
from media_ai.ai.sentiment import (
    SENTIMENT_POSITIVE,
    SENTIMENT_NEUTRAL,
    SENTIMENT_NEGATIVE,
    SENTIMENT_URGENT,
    SENTIMENT_SYSTEM_PROMPT,
    SentimentAnalysisResult,
    CommentSentimentAnalyzer,
)

__all__ = [
    "SENTIMENT_POSITIVE",
    "SENTIMENT_NEUTRAL",
    "SENTIMENT_NEGATIVE",
    "SENTIMENT_URGENT",
    "SENTIMENT_SYSTEM_PROMPT",
    "SentimentAnalysisResult",
    "CommentSentimentAnalyzer",
]
