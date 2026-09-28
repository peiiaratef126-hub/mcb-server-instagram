"""Tests for media validation and FFmpeg processing."""

import subprocess
import pytest
from pathlib import Path
from PIL import Image

from media_ai.validator import ImageValidator, VideoValidator
from media_ai.transcoder import convert_image_to_jpeg, transcode_to_reels


@pytest.fixture
def tmp_media_dir(tmp_path: Path) -> Path:
    media_dir = tmp_path / "media_test"
    media_dir.mkdir(parents=True, exist_ok=True)
    return media_dir


# --- Image Validation Tests ---

def test_valid_image(tmp_media_dir: Path):
    img_path = tmp_media_dir / "valid_square.jpg"
    img = Image.new("RGB", (1080, 1080), color=(100, 150, 200))
    img.save(img_path, "JPEG")

    result = ImageValidator.validate(img_path)
    assert result.is_valid is True
    assert result.media_type == "IMAGE"
    assert result.width == 1080
    assert result.height == 1080
    assert result.aspect_ratio == 1.0
    assert len(result.errors) == 0


def test_invalid_image_format(tmp_media_dir: Path):
    png_path = tmp_media_dir / "test.png"
    img = Image.new("RGBA", (1080, 1080), color=(255, 0, 0, 255))
    img.save(png_path, "PNG")

    result = ImageValidator.validate(png_path)
    assert result.is_valid is False
    assert any("strictly requires JPEG" in err for err in result.errors)

    # Transcoding / conversion helper fixes it
    converted_jpeg = tmp_media_dir / "converted.jpg"
    convert_image_to_jpeg(png_path, converted_jpeg)
    conv_result = ImageValidator.validate(converted_jpeg)
    assert conv_result.is_valid is True


def test_invalid_image_aspect_ratio(tmp_media_dir: Path):
    tall_path = tmp_media_dir / "too_tall.jpg"
    # 1:5 aspect ratio (way too narrow/tall for Instagram 4:5 limit)
    img = Image.new("RGB", (400, 2000), color=(50, 50, 50))
    img.save(tall_path, "JPEG")

    result = ImageValidator.validate(tall_path)
    assert result.is_valid is False
    assert any("outside allowed range 4:5" in err for err in result.errors)


# --- Video Validation & Transcoding Tests ---

def _generate_synthetic_video(output_path: Path, width: int, height: int, duration_sec: int) -> Path:
    """Uses local ffmpeg testsrc to generate a synthetic test video."""
    cmd = [
        "ffmpeg",
        "-y",
        "-f", "lavfi",
        "-i", f"testsrc=size={width}x{height}:rate=30",
        "-f", "lavfi",
        "-i", "sine=frequency=1000:sample_rate=48000",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-t", str(duration_sec),
        "-pix_fmt", "yuv420p",
        str(output_path),
    ]
    subprocess.run(cmd, capture_output=True, check=True)
    return output_path


def test_valid_reels_video(tmp_media_dir: Path):
    # 9:16 ratio (720x1280), 4 seconds
    reel_path = tmp_media_dir / "valid_reel.mp4"
    _generate_synthetic_video(reel_path, width=720, height=1280, duration_sec=4)

    result = VideoValidator.validate(reel_path, is_reels=True)
    assert result.is_valid is True
    assert result.media_type == "REELS"
    assert result.width == 720
    assert result.height == 1280
    assert result.duration_seconds is not None and result.duration_seconds >= 3.0
    assert len(result.errors) == 0


def test_critical_invalid_video_rejected_and_transcoded(tmp_media_dir: Path):
    """CRITICAL TEST: Pass an invalid/non-compliant video, assert rejection with

    clear errors, and assert successful transcoding into compliant Reels.
    """
    # 1. Create an invalid video: Horizontal 16:9 (1280x720) instead of 9:16, only 2 seconds (too short)
    invalid_video_path = tmp_media_dir / "invalid_horizontal.mp4"
    _generate_synthetic_video(invalid_video_path, width=1280, height=720, duration_sec=2)

    # 2. Assert rejection as a Reel
    result = VideoValidator.validate(invalid_video_path, is_reels=True)
    assert result.is_valid is False
    assert len(result.errors) >= 2  # Aspect ratio error and duration error

    # Verify descriptive error messages
    error_text = result.error_summary
    assert "Reels aspect ratio must be strictly 9:16" in error_text
    assert "shorter than minimum allowed 3.0s" in error_text

    # 3. Transcode invalid video into compliant Reel (pads to 1080x1920 9:16 and sets minimum/target duration)
    transcoded_reel_path = tmp_media_dir / "transcoded_reel.mp4"
    # Using ffmpeg to pad to 9:16 and extend or format properly
    transcode_to_reels(invalid_video_path, transcoded_reel_path, target_width=1080, target_height=1920)

    # Verify transcoded video dimensions and aspect ratio
    reprobed = VideoValidator._probe_video(transcoded_reel_path)
    assert reprobed is not None
    vstream = next(s for s in reprobed["streams"] if s["codec_type"] == "video")
    assert int(vstream["width"]) == 1080
    assert int(vstream["height"]) == 1920


def test_nonexistent_media():
    res = ImageValidator.validate(Path("nonexistent_image.jpg"))
    assert res.is_valid is False
    assert "File not found" in res.error_summary

    v_res = VideoValidator.validate(Path("nonexistent_video.mp4"), is_reels=True)
    assert v_res.is_valid is False
    assert "File not found" in v_res.error_summary
