"""Unit tests for Feature 22 AI Caption and Hashtag Generator."""

import json
from unittest.mock import MagicMock, patch
import pytest
from media_ai.ai.caption_generator import (
    CaptionGenerator,
    CaptionGenerationRequest,
    CaptionGenerationResult,
    MAX_INSTAGRAM_HASHTAGS,
    MAX_INSTAGRAM_CAPTION_CHARS,
)


def test_missing_api_key_returns_fallback(monkeypatch):
    """Verify missing API key produces graceful fallback with clear notification."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    gen = CaptionGenerator(api_key=None)

    assert not gen.is_configured
    req = CaptionGenerationRequest(
        topic="Launch of our new ceramic coffee mug collection",
        tone="promotional",
        call_to_action="Shop now at the link in our bio!",
        max_hashtags=5,
    )
    res = gen.generate(req)

    assert not res.is_enabled
    assert res.error == "ANTHROPIC_API_KEY_NOT_CONFIGURED"
    assert "ceramic coffee mug" in res.caption
    assert res.call_to_action == "Shop now at the link in our bio!"
    assert len(res.hashtags) <= 5
    assert len(res.full_text_with_hashtags) <= MAX_INSTAGRAM_CAPTION_CHARS


def _mock_anthropic_response(json_payload: dict):
    """Helper to mock Anthropic messages.create response."""
    mock_block = MagicMock()
    mock_block.text = json.dumps(json_payload)
    mock_resp = MagicMock()
    mock_resp.content = [mock_block]
    return mock_resp


def test_successful_caption_generation():
    """Verify successful generation with hook, body, and categorized hashtags."""
    gen = CaptionGenerator(api_key="sk-ant-test")

    mock_json = {
        "caption": "Say goodbye to lukewarm coffee! ☕ Our handcrafted ceramic mugs are officially here.\n\nEach piece is double-walled and uniquely glazed.",
        "hook": "Say goodbye to lukewarm coffee! ☕",
        "call_to_action": "Tap the link in bio to grab yours before they sell out!",
        "hashtags": ["#ceramicmug", "#coffeetime", "#artisan", "#coffeelovers"],
        "tone_applied": "promotional",
        "language": "english",
        "content_tips": "Pair with a high-res carousel showing details of the ceramic glaze.",
    }

    with patch.object(gen, "_get_client") as mock_get:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response(mock_json)
        mock_get.return_value = mock_client

        req = CaptionGenerationRequest(
            topic="Handcrafted ceramic mugs launch",
            tone="promotional",
            max_hashtags=10,
        )
        res = gen.generate(req)

        assert res.is_enabled
        assert res.hook == "Say goodbye to lukewarm coffee! ☕"
        assert res.tone_applied == "promotional"
        assert len(res.hashtags) == 4
        assert "#ceramicmug" in res.hashtags
        assert res.content_tips is not None
        assert "#coffeelovers" in res.full_text_with_hashtags


def test_hashtag_limit_clamping():
    """Verify that requests exceeding 30 hashtags are clamped to Meta's max 30."""
    gen = CaptionGenerator(api_key="sk-ant-test")

    # Generate list of 40 tags in mock output
    mock_tags = [f"#tag{i}" for i in range(40)]
    mock_json = {
        "caption": "Awesome test caption",
        "hook": "Hook",
        "call_to_action": "CTA",
        "hashtags": mock_tags,
        "tone_applied": "casual",
        "language": "english",
    }

    with patch.object(gen, "_get_client") as mock_get:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response(mock_json)
        mock_get.return_value = mock_client

        req = CaptionGenerationRequest(
            topic="Test clamping",
            max_hashtags=30,
        )
        res = gen.generate(req)

        assert len(res.hashtags) <= MAX_INSTAGRAM_HASHTAGS
        assert len(res.hashtags) == 30


def test_arabic_caption_generation():
    """Verify Arabic caption generation with authentic styling."""
    gen = CaptionGenerator(api_key="sk-ant-test")

    mock_json = {
        "caption": "جاهز للخطوة الجاية؟ 🚀 تشكيلة خريف 2026 صارت متوفرة الآن في جميع الفروع.\n\nتصاميم تجمع بين الأناقة والراحة اليومية.",
        "hook": "جاهز للخطوة الجاية؟ 🚀",
        "call_to_action": "اطلب الآن عبر الرابط في البايو أو زوروا أقرب فرع!",
        "hashtags": ["#موضة", "#أناقة", "#خريف2026", "#تسوق"],
        "tone_applied": "inspirational",
        "language": "arabic",
        "content_tips": "انشر في وقت الذروة المسائي للحصول على أعلى تفاعل.",
    }

    with patch.object(gen, "_get_client") as mock_get:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_anthropic_response(mock_json)
        mock_get.return_value = mock_client

        req = CaptionGenerationRequest(
            topic="إطلاق تشكيلة خريف 2026",
            tone="inspirational",
            language="arabic",
        )
        res = gen.generate(req)

        assert res.is_enabled
        assert "خريف 2026" in res.caption
        assert res.language == "arabic"
        assert "#موضة" in res.hashtags


def test_api_error_fallback():
    """Verify fallback behavior when Claude API call fails."""
    gen = CaptionGenerator(api_key="sk-ant-test")

    with patch.object(gen, "_get_client") as mock_get:
        mock_client = MagicMock()
        mock_client.messages.create.side_effect = Exception("Anthropic internal 500 error")
        mock_get.return_value = mock_client

        req = CaptionGenerationRequest(topic="New fitness gear")
        res = gen.generate(req)

        assert res.is_enabled
        assert res.error is not None
        assert "API_ERROR" in res.error
        assert "New fitness gear" in res.caption
