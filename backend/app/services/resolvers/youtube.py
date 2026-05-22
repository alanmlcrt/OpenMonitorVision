import re
from .base import StreamResolver, PlatformMeta


class YouTubeResolver(StreamResolver):
    meta = PlatformMeta(name="YouTube", color="#ef4444", icon="▶")
    _RE = re.compile(r"youtube\.com|youtu\.be", re.I)

    @classmethod
    def matches(cls, url: str) -> bool:
        return bool(cls._RE.search(url))

    @classmethod
    def resolve(cls, url: str) -> str:
        # VODs: best pre-merged MP4 ≤720p.
        # Above 720p YouTube splits audio/video — OpenCV can't mux on the fly.
        # Live streams: yt-dlp returns the HLS manifest URL directly.
        opts = {
            "quiet": True,
            "no_warnings": True,
            "format": "best[height<=720][ext=mp4]/best[height<=720]/best",
            "skip_download": True,
            "no_cache_dir": True,
            "socket_timeout": 20,
        }
        info = cls._yt_dlp_extract(url, opts)
        try:
            return cls._pick_url(info)
        except RuntimeError:
            raise RuntimeError(
                "YouTube: could not extract stream URL. "
                "The video may be private, age-restricted, or members-only."
            )
