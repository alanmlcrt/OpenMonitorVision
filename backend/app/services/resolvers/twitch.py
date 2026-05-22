import re
from .base import StreamResolver, PlatformMeta


class TwitchResolver(StreamResolver):
    meta = PlatformMeta(name="Twitch", color="#a855f7", icon="◉")
    _RE = re.compile(r"twitch\.tv", re.I)

    @classmethod
    def matches(cls, url: str) -> bool:
        return bool(cls._RE.search(url))

    @classmethod
    def resolve(cls, url: str) -> str:
        # Live channels: HLS manifest.  Prefer 720p60 for smooth detection.
        # VODs: direct HLS segments.
        opts = {
            "quiet": True,
            "no_warnings": True,
            "format": "720p60/720p60_alt/720p/480p/best",
            "skip_download": True,
            "no_cache_dir": True,
            "socket_timeout": 20,
        }
        info = cls._yt_dlp_extract(url, opts)
        try:
            return cls._pick_url(info)
        except RuntimeError:
            raise RuntimeError(
                "Twitch: could not extract stream URL. "
                "The channel may be offline, subscriber-only, or the URL is invalid."
            )
