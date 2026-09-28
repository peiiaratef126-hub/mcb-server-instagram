"""Unit tests for Feature 24 Comment Sentiment Analysis with Arabic Dialect Support."""

import json
from unittest.mock import MagicMock, patch
import pytest
from media_ai.ai.sentiment import (
    CommentSentimentAnalyzer,
    SentimentAnalysisResult,
    SENTIMENT_POSITIVE,
    SENTIMENT_NEUTRAL,
    SENTIMENT_NEGATIVE,
    SENTIMENT_URGENT,
)


def test_missing_api_key_returns_graceful_warning(monkeypatch):
    """STRICT RULE 4: When ANTHROPIC_API_KEY is missing, gracefully return warning."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    analyzer = CommentSentimentAnalyzer(api_key=None)

    assert not analyzer.is_configured
    res = analyzer.analyze_comment("منتج رائع جداً")
    assert not res.is_enabled
    assert res.sentiment == "unknown"
    assert res.error == "ANTHROPIC_API_KEY_NOT_CONFIGURED"
    assert "ANTHROPIC_API_KEY" in res.reasoning
    assert res.suggested_action is not None


def test_empty_comment_handling():
    """Verify empty string returns neutral sentiment with 1.0 confidence."""
    analyzer = CommentSentimentAnalyzer(api_key="sk-ant-test")
    res = analyzer.analyze_comment("   ")
    assert res.sentiment == SENTIMENT_NEUTRAL
    assert res.confidence == 1.0
    assert res.language_or_dialect == "empty"


def _mock_anthropic_response(json_payload: dict):
    """Helper to mock Anthropic messages.create response."""
    mock_block = MagicMock()
    mock_block.text = json.dumps(json_payload)
    mock_resp = MagicMock()
    mock_resp.content = [mock_block]
    return mock_resp


def test_egyptian_positive_sentiment():
    """Verify Egyptian dialect positive compliment."""
    analyzer = CommentSentimentAnalyzer(api_key="sk-ant-test")

    mock_json = {
        "sentiment": "positive",
        "confidence": 0.98,
        "language_or_dialect": "arabic_egyptian",
        "urgency_score": 0.05,
        "requires_immediate_action": False,
        "reasoning": "User praises the product enthusiastically using Egyptian dialect idiom 'تحفة' and 'عاش'.",
        "suggested_action": "Reply with a warm thank you.",
    }

    with patch.object(analyzer, "_get_client") as mock_get:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response(mock_json)
        mock_get.return_value = mock_client

        res = analyzer.analyze_comment(
            comment_text="المنتج ده تحفة بجد وعاش يا شباب استمروا",
            comment_id="c_eg_1",
        )

        assert res.is_enabled
        assert res.sentiment == SENTIMENT_POSITIVE
        assert res.confidence == 0.98
        assert res.language_or_dialect == "arabic_egyptian"
        assert not res.requires_immediate_action
        assert res.comment_id == "c_eg_1"


def test_gulf_urgent_escalation():
    """Verify Gulf dialect urgent escalation for missing paid order."""
    analyzer = CommentSentimentAnalyzer(api_key="sk-ant-test")

    mock_json = {
        "sentiment": "urgent",
        "confidence": 0.99,
        "language_or_dialect": "arabic_gulf",
        "urgency_score": 0.95,
        "requires_immediate_action": True,
        "reasoning": "Customer indicates paid order not delivered after 2 weeks and threatens fraud accusations.",
        "suggested_action": "Escalate to priority support immediately and send direct message.",
    }

    with patch.object(analyzer, "_get_client") as mock_get:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response(mock_json)
        mock_get.return_value = mock_client

        res = analyzer.analyze_comment(
            comment_text="وين طلبي صارلي اسبوعين دافع وما وصل! نصابين ردوا علي بالخاص",
            comment_id="c_gulf_urgent",
        )

        assert res.is_enabled
        assert res.sentiment == SENTIMENT_URGENT
        assert res.requires_immediate_action
        assert res.urgency_score >= 0.9
        assert res.language_or_dialect == "arabic_gulf"


def test_levantine_neutral_inquiry():
    """Verify Levantine inquiry about prices/availability."""
    analyzer = CommentSentimentAnalyzer(api_key="sk-ant-test")

    mock_json = {
        "sentiment": "neutral",
        "confidence": 0.92,
        "language_or_dialect": "arabic_levantine",
        "urgency_score": 0.1,
        "requires_immediate_action": False,
        "reasoning": "Product inquiry asking about available sizes.",
        "suggested_action": "Provide sizing guide in comments or DM.",
    }

    with patch.object(analyzer, "_get_client") as mock_get:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response(mock_json)
        mock_get.return_value = mock_client

        res = analyzer.analyze_comment("بدي اسأل لو سمحت شو المقاسات المتوفرة؟")
        assert res.sentiment == SENTIMENT_NEUTRAL
        assert res.language_or_dialect == "arabic_levantine"
        assert not res.requires_immediate_action


def test_north_african_negative_feedback():
    """Verify Maghrebi/Moroccan negative product review."""
    analyzer = CommentSentimentAnalyzer(api_key="sk-ant-test")

    mock_json = {
        "sentiment": "negative",
        "confidence": 0.94,
        "language_or_dialect": "arabic_maghrebi",
        "urgency_score": 0.4,
        "requires_immediate_action": False,
        "reasoning": "Customer dissatisfied with item quality using Moroccan Darija 'ما عجباتنيش كاع'.",
        "suggested_action": "Reach out to understand dissatisfaction and offer exchange.",
    }

    with patch.object(analyzer, "_get_client") as mock_get:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response(mock_json)
        mock_get.return_value = mock_client

        res = analyzer.analyze_comment("السلعة ما عجباتنيش كاع صراحة خيبة بزاف")
        assert res.sentiment == SENTIMENT_NEGATIVE
        assert res.language_or_dialect == "arabic_maghrebi"


def test_batch_analysis():
    """Verify analyze_batch processes multiple comments."""
    analyzer = CommentSentimentAnalyzer(api_key="sk-ant-test")

    mock_json = {
        "sentiment": "positive",
        "confidence": 0.9,
        "language_or_dialect": "english",
        "urgency_score": 0.0,
        "requires_immediate_action": False,
        "reasoning": "Positive English comment.",
        "suggested_action": "Like comment",
    }

    with patch.object(analyzer, "_get_client") as mock_get:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response(mock_json)
        mock_get.return_value = mock_client

        batch = [
            {"id": "1", "text": "Loved it!"},
            {"id": "2", "text": "Great service!"},
        ]
        results = analyzer.analyze_batch(batch)
        assert len(results) == 2
        assert results[0].comment_id == "1"
        assert results[1].comment_id == "2"


def test_api_exception_handling():
    """Verify that network or API exceptions are caught and reported without crashing."""
    analyzer = CommentSentimentAnalyzer(api_key="sk-ant-test")

    with patch.object(analyzer, "_get_client") as mock_get:
        mock_client = MagicMock()
        mock_client.messages.create.side_effect = RuntimeError("Rate limit exceeded")
        mock_get.return_value = mock_client

        res = analyzer.analyze_comment("Any comment")
        assert res.is_enabled
        assert res.sentiment == "unknown"
        assert "API_ERROR" in str(res.error)
        assert "Rate limit exceeded" in res.reasoning
