import re
from .base import StreamResolver, PlatformMeta

_KNOWN: list[tuple[re.Pattern, PlatformMeta]] = [
    (re.compile(r"vimeo\.com", re.I),             PlatformMeta("Vimeo",       "#22d3ee", "▶")),
    (re.compile(r"dailymotion\.com", re.I),        PlatformMeta("Dailymotion", "#f59e0b", "▶")),
    (re.compile(r"twitter\.com|x\.com", re.I),     PlatformMeta("X (Twitter)", "#94a3b8", "✕")),
    (re.compile(r"tiktok\.com", re.I),             PlatformMeta("TikTok",      "#ec4899", "♪")),
    (re.compile(r"instagram\.com", re.I),          PlatformMeta("Instagram",   "#e879f9", "◎")),
    (re.compile(r"kick\.com", re.I),               PlatformMeta("Kick",        "#22c55e", "◉")),
    (re.compile(r"reddit\.com|redd\.it", re.I),    PlatformMeta("Reddit",      "#f97316", "◎")),
    (re.compile(r"facebook\.com|fb\.watch", re.I), PlatformMeta("Facebook",    "#3b82f6", "◎")),
    (re.compile(r"bilibili\.com", re.I),           PlatformMeta("Bilibili",    "#f43f5e", "▶")),
]

DEFAULT_META = PlatformMeta("Web stream", "#64748b", "◎")


def meta_for_url(url: str) -> PlatformMeta:
    for pattern, m in _KNOWN:
        if pattern.search(url):
            return m
    return DEFAULT_META


class GenericResolver(StreamResolver):
    meta = DEFAULT_META

    @classmethod
    def matches(cls, url: str) -> bool:
        return url.startswith(("http://", "https://"))

    @classmethod
    def resolve(cls, url: str) -> str:
        opts = {
            "quiet": True,
            "no_warnings": True,
            "format": "best[height<=1080][ext=mp4]/best[height<=1080]/best",
            "skip_download": True,
            "no_cache_dir": True,
            "socket_timeout": 20,
        }
        info = cls._yt_dlp_extract(url, opts)
        return cls._pick_url(info)
