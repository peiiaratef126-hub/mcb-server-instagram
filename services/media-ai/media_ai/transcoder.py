"""FFmpeg and Pillow media processing and transcoding utilities.

Converts non-compliant media files into Meta-compliant formats.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from PIL import Image


def convert_image_to_jpeg(input_path: str | Path, output_path: str | Path, quality: int = 95) -> Path:
    """Converts any image (PNG, WebP, TIFF) to a Meta-compliant JPEG."""
    in_path = Path(input_path)
    out_path = Path(output_path)

    with Image.open(in_path) as img:
        # Convert RGBA / palette images to RGB
        if img.mode in ("RGBA", "P", "LA"):
            rgb_img = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "RGBA":
                rgb_img.paste(img, mask=img.split()[3])
            else:
                rgb_img.paste(img.convert("RGB"))
        else:
            rgb_img = img.convert("RGB")

        out_path.parent.mkdir(parents=True, exist_ok=True)
        rgb_img.save(out_path, "JPEG", quality=quality, optimize=True)

    return out_path


def transcode_to_reels(
    input_path: str | Path,
    output_path: str | Path,
    target_width: int = 1080,
    target_height: int = 1920,
    max_duration_sec: float = 90.0,
) -> Path:
    """Transcodes and pads/scales any video into a compliant 9:16 Instagram Reel.

    Uses FFmpeg to:
    - Scale while preserving aspect ratio and pad to 1080x1920 with black bars.
    - Re-encode video with H.264 (yuv420p) at high quality.
    - Re-encode audio with AAC 48kHz stereo.
    - Trim duration if longer than max_duration_sec.
    """
    in_path = Path(input_path)
    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Scale filter with aspect ratio preservation and black letterbox padding
    filter_complex = (
        f"scale={target_width}:{target_height}:force_original_aspect_ratio=decrease,"
        f"pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2:black,"
        "format=yuv420p"
    )

    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(in_path),
        "-vf", filter_complex,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "48000",
        "-t", str(max_duration_sec),
        "-movflags", "+faststart",
        str(out_path),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg transcoding failed: {result.stderr}")

    return out_path
