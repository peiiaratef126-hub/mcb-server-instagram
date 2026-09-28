"""Feature 23 — Best Time to Post Analytics Engine.

Analyzes historical Instagram post performance (likes, comments, reach, impressions,
shares, saves) grouped by day of week and hour of day, generating an engagement
heatmap and ranked publishing time slot recommendations.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union
import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

DAYS_OF_WEEK = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]

# Benchmark default slots when historical data is insufficient (< 3 posts)
# Based on cross-industry Instagram engagement benchmarks (UTC)
BENCHMARK_SLOTS = [
    {"day_of_week": 2, "day_name": "Wednesday", "hour": 11, "score": 85.0, "confidence": "benchmark"},
    {"day_of_week": 4, "day_name": "Friday", "hour": 10, "score": 82.0, "confidence": "benchmark"},
    {"day_of_week": 1, "day_name": "Tuesday", "hour": 14, "score": 80.0, "confidence": "benchmark"},
    {"day_of_week": 3, "day_name": "Thursday", "hour": 19, "score": 78.0, "confidence": "benchmark"},
    {"day_of_week": 0, "day_name": "Monday", "hour": 12, "score": 75.0, "confidence": "benchmark"},
]

BEST_TIME_ANALYTICS_SQL = """
-- ====================================================================
-- Feature 23: Best Time to Post Historical Aggregation Query
-- Groups historical published posts by day of week (1=Mon..7=Sun) and hour
-- ====================================================================
SELECT 
    EXTRACT(ISODOW FROM created_at)::int AS day_of_week,
    EXTRACT(HOUR FROM created_at)::int AS hour_of_day,
    COUNT(*) AS total_posts,
    ROUND(AVG(COALESCE((payload->>'like_count')::numeric, 0)), 2) AS avg_likes,
    ROUND(AVG(COALESCE((payload->>'comments_count')::numeric, 0)), 2) AS avg_comments,
    ROUND(AVG(
        COALESCE((payload->>'like_count')::numeric, 0) * 1.0 + 
        COALESCE((payload->>'comments_count')::numeric, 0) * 2.0 +
        COALESCE((payload->>'saved_count')::numeric, 0) * 2.5 +
        COALESCE((payload->>'shares_count')::numeric, 0) * 3.0
    ), 2) AS weighted_engagement_score
FROM publish_queue
WHERE status = 'published'
  AND account_id = :account_id
GROUP BY day_of_week, hour_of_day
HAVING COUNT(*) >= 1
ORDER BY weighted_engagement_score DESC;
""".strip()


class PostMetrics(BaseModel):
    """Input metric record for a single Instagram post."""
    id: str
    timestamp: str  # ISO-8601 string, e.g. 2026-09-20T14:30:00Z
    like_count: int = 0
    comments_count: int = 0
    reach: Optional[int] = None
    impressions: Optional[int] = None
    saved_count: Optional[int] = 0
    shares_count: Optional[int] = 0


class TimeSlotRecommendation(BaseModel):
    """A recommended publishing time slot with performance metrics."""
    day_of_week: int = Field(..., ge=0, le=6, description="0=Monday, 6=Sunday")
    day_name: str
    hour: int = Field(..., ge=0, le=23, description="Hour in UTC (0-23)")
    score: float = Field(..., description="Normalized engagement score (0-100)")
    sample_size: int = Field(default=0, description="Number of historical posts in this slot")
    confidence: str = Field(..., description="'high', 'medium', 'low', or 'benchmark'")
    avg_likes: float = 0.0
    avg_comments: float = 0.0
    avg_reach: Optional[float] = None


class BestTimeToPostResult(BaseModel):
    """Full best time to post analysis output including ranked slots and heatmap."""
    ranked_slots: List[TimeSlotRecommendation]
    heatmap: List[List[float]] = Field(
        ...,
        description="7 rows (Monday-Sunday) x 24 columns (hours 0-23) normalized scores (0-100)",
    )
    best_overall_day: str
    best_overall_hour: int
    confidence_level: str
    total_posts_analyzed: int
    recommendations_summary: str


def _parse_timestamp(ts: str) -> Optional[datetime]:
    """Safely parse diverse ISO-8601 timestamp formats to UTC datetime."""
    try:
        # Handle 'Z' suffix
        cleaned = ts.replace("Z", "+00:00")
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt
    except Exception:
        return None


def calculate_best_time_to_post(
    posts: List[Union[PostMetrics, Dict[str, Any]]],
    min_confidence_posts: int = 3,
) -> BestTimeToPostResult:
    """Calculates best time to post recommendations and 7x24 heatmap from historical posts.

    Args:
        posts: List of PostMetrics models or raw dicts containing post engagement stats.
        min_confidence_posts: Minimum post count required to rely on account history
                              instead of benchmark defaults (default 3).

    Returns:
        BestTimeToPostResult with ranked recommendations and engagement heatmap.
    """
    # 1. Parse and validate input records
    parsed_posts = []
    for item in posts:
        if isinstance(item, dict):
            try:
                m = PostMetrics(**item)
            except Exception:
                continue
        elif isinstance(item, PostMetrics):
            m = item
        else:
            continue

        dt = _parse_timestamp(m.timestamp)
        if dt is None:
            continue

        # Compute engagement score for this post
        # Base formula: likes + 2*comments + 2.5*saves + 3*shares
        raw_score = (
            (m.like_count or 0) * 1.0
            + (m.comments_count or 0) * 2.0
            + (m.saved_count or 0) * 2.5
            + (m.shares_count or 0) * 3.0
        )

        # If reach is available and > 0, compute percentage engagement rate
        if m.reach and m.reach > 0:
            effective_score = (raw_score / m.reach) * 100.0
        else:
            effective_score = raw_score

        parsed_posts.append({
            "id": m.id,
            "datetime": dt,
            "day_of_week": dt.weekday(),  # 0=Monday, 6=Sunday
            "hour": dt.hour,              # 0=23
            "like_count": m.like_count or 0,
            "comments_count": m.comments_count or 0,
            "reach": m.reach,
            "effective_score": effective_score,
            "raw_score": raw_score,
        })

    # 2. Check for insufficient data
    if len(parsed_posts) < min_confidence_posts:
        # Build baseline heatmap with default benchmark slots
        heatmap = [[5.0 for _ in range(24)] for _ in range(7)]
        ranked_slots: List[TimeSlotRecommendation] = []

        for b in BENCHMARK_SLOTS:
            dow = b["day_of_week"]
            hr = b["hour"]
            score = float(b["score"])
            heatmap[dow][hr] = score
            # slight bleed into adjacent hours
            if hr > 0:
                heatmap[dow][hr - 1] = max(heatmap[dow][hr - 1], score * 0.75)
            if hr < 23:
                heatmap[dow][hr + 1] = max(heatmap[dow][hr + 1], score * 0.75)

            ranked_slots.append(
                TimeSlotRecommendation(
                    day_of_week=dow,
                    day_name=DAYS_OF_WEEK[dow],
                    hour=hr,
                    score=score,
                    sample_size=0,
                    confidence="benchmark",
                    avg_likes=0.0,
                    avg_comments=0.0,
                    avg_reach=None,
                )
            )

        ranked_slots.sort(key=lambda s: s.score, reverse=True)

        return BestTimeToPostResult(
            ranked_slots=ranked_slots,
            heatmap=heatmap,
            best_overall_day="Wednesday",
            best_overall_hour=11,
            confidence_level="benchmark",
            total_posts_analyzed=len(parsed_posts),
            recommendations_summary=(
                f"Insufficient historical data ({len(parsed_posts)} posts found; minimum is {min_confidence_posts}). "
                "Recommendations are based on industry-standard Instagram engagement benchmarks (UTC). "
                "Top suggested slot: Wednesday at 11:00 UTC."
            ),
        )

    # 3. Aggregate posts by day_of_week and hour using pandas
    df = pd.DataFrame(parsed_posts)

    grouped = df.groupby(["day_of_week", "hour"]).agg(
        sample_size=("id", "count"),
        mean_score=("effective_score", "mean"),
        avg_likes=("like_count", "mean"),
        avg_comments=("comments_count", "mean"),
        avg_reach=("reach", "mean"),
    ).reset_index()

    # Determine normalization scaling
    max_raw_score = grouped["mean_score"].max()
    min_raw_score = grouped["mean_score"].min()
    score_range = max(max_raw_score - min_raw_score, 1e-6)

    # Build 7x24 heatmap initialized with base ambient engagement
    heatmap_matrix = np.full((7, 24), 10.0)

    for _, row in grouped.iterrows():
        dow = int(row["day_of_week"])
        hr = int(row["hour"])
        norm_score = ((row["mean_score"] - min_raw_score) / score_range) * 80.0 + 20.0
        heatmap_matrix[dow, hr] = norm_score

    # Apply 1D smoothing across adjacent hours for visual and ranking continuity
    smoothed_heatmap = heatmap_matrix.copy()
    for dow in range(7):
        for hr in range(24):
            prev_hr = (hr - 1) % 24
            next_hr = (hr + 1) % 24
            smoothed_heatmap[dow, hr] = (
                0.20 * heatmap_matrix[dow, prev_hr]
                + 0.60 * heatmap_matrix[dow, hr]
                + 0.20 * heatmap_matrix[dow, next_hr]
            )

    # 4. Score and rank slots
    recommendations = []
    for _, row in grouped.iterrows():
        dow = int(row["day_of_week"])
        hr = int(row["hour"])
        samples = int(row["sample_size"])
        smooth_score = float(smoothed_heatmap[dow, hr])

        # Bayesian confidence weighting: more samples increase confidence towards 1.0
        confidence_factor = min(samples / (samples + 2.0), 1.0)
        final_score = round(smooth_score * (0.7 + 0.3 * confidence_factor), 1)

        if samples >= 5:
            conf = "high"
        elif samples >= 2:
            conf = "medium"
        else:
            conf = "low"

        recommendations.append(
            TimeSlotRecommendation(
                day_of_week=dow,
                day_name=DAYS_OF_WEEK[dow],
                hour=hr,
                score=final_score,
                sample_size=samples,
                confidence=conf,
                avg_likes=round(float(row["avg_likes"]), 1),
                avg_comments=round(float(row["avg_comments"]), 1),
                avg_reach=round(float(row["avg_reach"]), 1) if pd.notna(row["avg_reach"]) else None,
            )
        )

    # Sort descending by final score
    recommendations.sort(key=lambda s: (s.score, s.sample_size), reverse=True)

    # Calculate best overall day and hour across all posts
    day_means = df.groupby("day_of_week")["effective_score"].mean()
    best_dow = int(day_means.idxmax())
    best_day_name = DAYS_OF_WEEK[best_dow]

    hour_means = df.groupby("hour")["effective_score"].mean()
    best_hr = int(hour_means.idxmax())

    overall_confidence = "high" if len(parsed_posts) >= 15 else "medium"

    top_rec = recommendations[0] if recommendations else None
    top_desc = (
        f"{top_rec.day_name} at {top_rec.hour:02d}:00 UTC (score: {top_rec.score}, {top_rec.confidence} confidence)"
        if top_rec
        else f"{best_day_name} at {best_hr:02d}:00 UTC"
    )

    summary = (
        f"Analyzed {len(parsed_posts)} historical posts. Optimal publishing window is {top_desc}. "
        f"Peak performance historically occurs on {best_day_name}s around {best_hr:02d}:00 UTC."
    )

    return BestTimeToPostResult(
        ranked_slots=recommendations[:10],
        heatmap=[[round(float(val), 1) for val in row] for row in smoothed_heatmap],
        best_overall_day=best_day_name,
        best_overall_hour=best_hr,
        confidence_level=overall_confidence,
        total_posts_analyzed=len(parsed_posts),
        recommendations_summary=summary,
    )
