"""
Public API for web stream resolution.
Dispatches to per-platform resolvers (YouTube, Twitch, generic yt-dlp).
Results are cached 4 hours — YouTube direct URLs expire ~6h, Twitch ~24h.
"""
import threading
import time
from dataclasses import dataclass, field

from app.core.logging import get_logger
from app.services.resolvers import get_resolver, get_meta

logger = get_logger(__name__)

_CACHE_TTL = 4 * 3600


@dataclass
class _Entry:
    resolved: str
    ts: float = field(default_factory=time.monotonic)

    def expired(self) -> bool:
        return (time.monotonic() - self.ts) >= _CACHE_TTL


_cache: dict[str, _Entry] = {}
_lock = threading.Lock()


def detect_platform(url: str) -> dict:
    """Return {'name': ..., 'color': ..., 'icon': ...} for UI display."""
    m = get_meta(url)
    return {"name": m.name, "color": m.color, "icon": m.icon}


def resolve(url: str, *, force: bool = False) -> str:
    """
    Resolve a web stream URL to a direct HLS/MP4 URL that OpenCV can open.

    Uses per-platform resolvers (YouTube, Twitch, generic).
    Results are cached 4 h.  Pass force=True to bypass cache.
    Raises RuntimeError with a user-friendly message on failure.
    """
    if not force:
        with _lock:
            entry = _cache.get(url)
            if entry and not entry.expired():
                logger.debug("stream_resolver: cache hit for %s", url)
                return entry.resolved

    resolver_cls = get_resolver(url)
    if resolver_cls is None:
        raise RuntimeError(
            f"No resolver available for this URL: {url}\n"
            "Only http:// and https:// URLs are supported."
        )

    platform = resolver_cls.meta.name
    logger.info("stream_resolver: [%s] resolving %s", platform, url)

    # Each resolver raises RuntimeError with a platform-specific message
    resolved = resolver_cls.resolve(url)

    with _lock:
        _cache[url] = _Entry(resolved=resolved)

    logger.info("stream_resolver: [%s] → %s…", platform, resolved[:80])
    return resolved


def invalidate(url: str) -> None:
    """Remove cached URL so the next call forces fresh resolution."""
    with _lock:
        removed = _cache.pop(url, None)
    if removed:
        logger.info("stream_resolver: cache invalidated for %s", url)
