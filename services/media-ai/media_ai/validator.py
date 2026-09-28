"""Media validation service for Meta Instagram Graph API compliance.

Enforces official Instagram guidelines for single images, feed videos, and Reels.
"""

from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from PIL import Image


# Official Meta Constraints
MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024  # 8 MB
MIN_IMAGE_DIMENSION = 320
MIN_IMAGE_ASPECT_RATIO = 0.80  # 4:5 (1080x1350)
MAX_IMAGE_ASPECT_RATIO = 1.91  # 1.91:1 (1080x566)

MAX_FEED_VIDEO_SIZE_BYTES = 100 * 1024 * 1024  # 100 MB
MAX_REELS_SIZE_BYTES = 1024 * 1024 * 1024  # 1 GB
MIN_VIDEO_DURATION_SEC = 3.0
MAX_FEED_VIDEO_DURATION_SEC = 60.0
MAX_REELS_DURATION_SEC = 90.0
REELS_TARGET_ASPECT_RATIO = 9 / 16  # 0.5625
ASPECT_RATIO_TOLERANCE = 0.05


@dataclass
class ValidationResult:
    is_valid: bool
    media_type: str  # "IMAGE", "VIDEO", "REELS"
    width: int = 0
    height: int = 0
    aspect_ratio: float = 0.0
    file_size_bytes: int = 0
    duration_seconds: float | None = None
    format: str = ""
    video_codec: str | None = None
    audio_codec: str | None = None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def error_summary(self) -> str:
        return "; ".join(self.errors)


class ImageValidator:
    """Validates images against Meta Instagram Graph API requirements."""

    @staticmethod
    def validate(file_path: str | Path) -> ValidationResult:
        path = Path(file_path)
        if not path.exists():
            return ValidationResult(
                is_valid=False,
                media_type="IMAGE",
                errors=[f"File not found: {path}"],
            )

        file_size = path.stat().st_size
        errors: list[str] = []
        warnings: list[str] = []

        if file_size > MAX_IMAGE_SIZE_BYTES:
            errors.append(
                f"Image file size ({file_size / (1024 * 1024):.2f} MB) exceeds maximum allowed 8 MB"
            )

        try:
            with Image.open(path) as img:
                img_format = (img.format or "").upper()
                width, height = img.size
        except Exception as e:
            return ValidationResult(
                is_valid=False,
                media_type="IMAGE",
                file_size_bytes=file_size,
                errors=[f"Corrupt or invalid image file: {e}"],
            )

        if img_format not in ("JPEG", "JPG"):
            errors.append(
                f"Invalid image format '{img_format}'. Meta Graph API strictly requires JPEG."
            )

        if width < MIN_IMAGE_DIMENSION or height < MIN_IMAGE_DIMENSION:
            errors.append(
                f"Image dimensions ({width}x{height}) are smaller than minimum allowed ({MIN_IMAGE_DIMENSION}x{MIN_IMAGE_DIMENSION})"
            )

        aspect_ratio = width / height if height > 0 else 0.0
        if aspect_ratio < (MIN_IMAGE_ASPECT_RATIO - 0.01) or aspect_ratio > (MAX_IMAGE_ASPECT_RATIO + 0.01):
            errors.append(
                f"Aspect ratio {aspect_ratio:.2f} is outside allowed range 4:5 (0.80) to 1.91:1 (1.91)"
            )

        return ValidationResult(
            is_valid=len(errors) == 0,
            media_type="IMAGE",
            width=width,
            height=height,
            aspect_ratio=round(aspect_ratio, 4),
            file_size_bytes=file_size,
            format=img_format,
            errors=errors,
            warnings=warnings,
        )


class VideoValidator:
    """Validates feed videos and Reels using ffprobe metadata inspection."""

    @staticmethod
    def _probe_video(file_path: Path) -> dict[str, Any] | None:
        cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            str(file_path),
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            return json.loads(result.stdout)
        except Exception:
            return None

    @classmethod
    def validate(cls, file_path: str | Path, is_reels: bool = False) -> ValidationResult:
        path = Path(file_path)
        media_type = "REELS" if is_reels else "VIDEO"

        if not path.exists():
            return ValidationResult(
                is_valid=False,
                media_type=media_type,
                errors=[f"File not found: {path}"],
            )

        file_size = path.stat().st_size
        errors: list[str] = []
        warnings: list[str] = []

        max_size = MAX_REELS_SIZE_BYTES if is_reels else MAX_FEED_VIDEO_SIZE_BYTES
        max_size_label = "1 GB" if is_reels else "100 MB"
        if file_size > max_size:
            errors.append(
                f"Video file size ({file_size / (1024 * 1024):.2f} MB) exceeds maximum allowed {max_size_label}"
            )

        metadata = cls._probe_video(path)
        if not metadata or "streams" not in metadata:
            return ValidationResult(
                is_valid=False,
                media_type=media_type,
                file_size_bytes=file_size,
                errors=["Failed to probe video streams using ffprobe. Ensure file is a valid video container."],
            )

        video_stream = None
        audio_stream = None
        for stream in metadata.get("streams", []):
            codec_type = stream.get("codec_type")
            if codec_type == "video" and not video_stream:
                video_stream = stream
            elif codec_type == "audio" and not audio_stream:
                audio_stream = stream

        if not video_stream:
            return ValidationResult(
                is_valid=False,
                media_type=media_type,
                file_size_bytes=file_size,
                errors=["No video stream found in container"],
            )

        width = int(video_stream.get("width", 0))
        height = int(video_stream.get("height", 0))
        video_codec = video_stream.get("codec_name", "").lower()
        audio_codec = audio_stream.get("codec_name", "").lower() if audio_stream else None

        # Codec check
        if video_codec not in ("h264", "avc1"):
            errors.append(f"Invalid video codec '{video_codec}'. H.264 is required by Meta Graph API.")

        # Duration check
        format_info = metadata.get("format", {})
        duration = float(format_info.get("duration", 0.0) or video_stream.get("duration", 0.0))

        max_duration = MAX_REELS_DURATION_SEC if is_reels else MAX_FEED_VIDEO_DURATION_SEC
        if duration < MIN_VIDEO_DURATION_SEC:
            errors.append(f"Video duration ({duration:.1f}s) is shorter than minimum allowed {MIN_VIDEO_DURATION_SEC}s")
        elif duration > max_duration:
            errors.append(
                f"Video duration ({duration:.1f}s) exceeds maximum allowed {max_duration:.0f}s for {media_type}"
            )

        # Aspect ratio check
        aspect_ratio = width / height if height > 0 else 0.0
        if is_reels:
            diff = abs(aspect_ratio - REELS_TARGET_ASPECT_RATIO)
            if diff > ASPECT_RATIO_TOLERANCE:
                errors.append(
                    f"Reels aspect ratio must be strictly 9:16 (~0.56). Current aspect ratio is {aspect_ratio:.2f} ({width}x{height})"
                )
        else:
            if aspect_ratio < (MIN_IMAGE_ASPECT_RATIO - 0.02) or aspect_ratio > (1.78 + 0.05):
                errors.append(
                    f"Feed video aspect ratio {aspect_ratio:.2f} is outside supported range 4:5 to 16:9"
                )

        container_format = format_info.get("format_name", "").lower()

        return ValidationResult(
            is_valid=len(errors) == 0,
            media_type=media_type,
            width=width,
            height=height,
            aspect_ratio=round(aspect_ratio, 4),
            file_size_bytes=file_size,
            duration_seconds=round(duration, 2),
            format=container_format,
            video_codec=video_codec,
            audio_codec=audio_codec,
            errors=errors,
            warnings=warnings,
        )
