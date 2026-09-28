"""Unit tests for Feature 23 Best Time to Post Analytics Engine."""

import pytest
from datetime import datetime, timezone
from media_ai.analytics.best_time import (
    PostMetrics,
    calculate_best_time_to_post,
    BEST_TIME_ANALYTICS_SQL,
    DAYS_OF_WEEK,
)


def test_insufficient_data_returns_benchmarks():
    """Verify that fewer than min_confidence_posts falls back to benchmark slots."""
    # Test empty input
    res_empty = calculate_best_time_to_post([])
    assert res_empty.confidence_level == "benchmark"
    assert res_empty.total_posts_analyzed == 0
    assert len(res_empty.ranked_slots) == 5
    assert res_empty.ranked_slots[0].day_name == "Wednesday"
    assert res_empty.ranked_slots[0].hour == 11
    assert len(res_empty.heatmap) == 7
    assert len(res_empty.heatmap[0]) == 24

    # Test with 2 posts (< 3 default min)
    two_posts = [
        {"id": "1", "timestamp": "2026-09-01T12:00:00Z", "like_count": 50, "comments_count": 5},
        {"id": "2", "timestamp": "2026-09-02T15:00:00Z", "like_count": 80, "comments_count": 10},
    ]
    res_two = calculate_best_time_to_post(two_posts, min_confidence_posts=3)
    assert res_two.confidence_level == "benchmark"
    assert res_two.total_posts_analyzed == 2
    assert "Insufficient historical data" in res_two.recommendations_summary


def test_analytics_with_synthetic_peaks():
    """Verify that a distinct peak slot (e.g. Friday 18:00 UTC) is correctly identified and ranked highest."""
    # Friday is day_of_week 4
    # 2026-09-04 is a Friday (2026-09-04T18:00:00Z)
    # 2026-09-11 is a Friday (2026-09-11T18:30:00Z)
    # 2026-09-18 is a Friday (2026-09-18T18:15:00Z)
    posts = [
        # Peak slot: Friday ~18:00 UTC (high engagement)
        {"id": "p1", "timestamp": "2026-09-04T18:00:00Z", "like_count": 500, "comments_count": 50, "saved_count": 30, "shares_count": 25},
        {"id": "p2", "timestamp": "2026-09-11T18:30:00Z", "like_count": 600, "comments_count": 70, "saved_count": 40, "shares_count": 30},
        {"id": "p3", "timestamp": "2026-09-18T18:15:00Z", "like_count": 550, "comments_count": 60, "saved_count": 35, "shares_count": 28},
        # Low slot: Monday 03:00 UTC
        {"id": "p4", "timestamp": "2026-09-07T03:00:00Z", "like_count": 10, "comments_count": 1, "saved_count": 0, "shares_count": 0},
        {"id": "p5", "timestamp": "2026-09-14T03:00:00Z", "like_count": 15, "comments_count": 2, "saved_count": 1, "shares_count": 0},
        # Moderate slot: Wednesday 12:00 UTC
        {"id": "p6", "timestamp": "2026-09-09T12:00:00Z", "like_count": 120, "comments_count": 15, "saved_count": 10, "shares_count": 5},
    ]

    result = calculate_best_time_to_post(posts, min_confidence_posts=3)

    assert result.total_posts_analyzed == 6
    assert result.confidence_level in ("medium", "high")
    assert len(result.ranked_slots) > 0

    top_slot = result.ranked_slots[0]
    assert top_slot.day_name == "Friday"
    assert top_slot.hour == 18
    assert top_slot.sample_size == 3
    assert top_slot.confidence == "medium"
    assert top_slot.avg_likes > 500
    assert result.best_overall_day == "Friday"
    assert result.best_overall_hour == 18

    # Heatmap checks: Friday (index 4) hour 18 should be the highest score in the heatmap
    heatmap = result.heatmap
    assert len(heatmap) == 7
    for row in heatmap:
        assert len(row) == 24
        for val in row:
            assert 0.0 <= val <= 100.0

    friday_18_score = heatmap[4][18]
    monday_3_score = heatmap[0][3]
    assert friday_18_score > monday_3_score


def test_analytics_with_reach_engagement_rate():
    """Verify that when reach is provided, engagement rate normalized by reach is utilized."""
    # Post A has 100 likes on 200 reach (50% engagement rate)
    # Post B has 150 likes on 10,000 reach (1.5% engagement rate)
    posts = [
        PostMetrics(id="a1", timestamp="2026-09-08T14:00:00Z", like_count=100, comments_count=20, reach=200),  # Tuesday
        PostMetrics(id="a2", timestamp="2026-09-15T14:00:00Z", like_count=120, comments_count=25, reach=220),  # Tuesday
        PostMetrics(id="b1", timestamp="2026-09-10T10:00:00Z", like_count=150, comments_count=10, reach=10000), # Thursday
        PostMetrics(id="b2", timestamp="2026-09-17T10:00:00Z", like_count=160, comments_count=12, reach=12000), # Thursday
    ]

    result = calculate_best_time_to_post(posts, min_confidence_posts=3)
    assert result.total_posts_analyzed == 4
    top_slot = result.ranked_slots[0]
    # Tuesday 14:00 has vastly higher engagement rate despite lower absolute likes
    assert top_slot.day_name == "Tuesday"
    assert top_slot.hour == 14


def test_diverse_timestamps_and_invalid_skipping():
    """Verify timestamps with timezone offsets and resilience against malformed records."""
    posts = [
        {"id": "ok1", "timestamp": "2026-09-06T19:00:00+03:00", "like_count": 200},  # Converts to 16:00 UTC Sunday
        {"id": "ok2", "timestamp": "2026-09-13T16:00:00Z", "like_count": 250},        # 16:00 UTC Sunday
        {"id": "ok3", "timestamp": "2026-09-20T16:00:00.000Z", "like_count": 220},    # 16:00 UTC Sunday
        {"id": "bad1", "timestamp": "invalid-timestamp", "like_count": 5000},          # Skipped
        {"id": "bad2"},                                                                 # Missing timestamp, skipped
    ]

    result = calculate_best_time_to_post(posts, min_confidence_posts=3)
    assert result.total_posts_analyzed == 3
    top_slot = result.ranked_slots[0]
    assert top_slot.day_name == "Sunday"
    assert top_slot.hour == 16


def test_sql_query_constant():
    """Verify that BEST_TIME_ANALYTICS_SQL is defined and contains expected SQL clauses."""
    assert "EXTRACT(ISODOW FROM created_at)" in BEST_TIME_ANALYTICS_SQL
    assert "EXTRACT(HOUR FROM created_at)" in BEST_TIME_ANALYTICS_SQL
    assert "FROM publish_queue" in BEST_TIME_ANALYTICS_SQL
    assert "GROUP BY day_of_week, hour_of_day" in BEST_TIME_ANALYTICS_SQL
