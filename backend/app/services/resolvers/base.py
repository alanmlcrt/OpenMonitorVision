from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class PlatformMeta:
    name: str
    color: str
    icon: str


class StreamResolver(ABC):
    meta: PlatformMeta

    @classmethod
    @abstractmethod
    def matches(cls, url: str) -> bool: ...

    @classmethod
    @abstractmethod
    def resolve(cls, url: str) -> str:
        """Return a direct streamable URL. Raise RuntimeError on failure."""
        ...

    @staticmethod
    def _yt_dlp_extract(url: str, ydl_opts: dict) -> dict:
        try:
            import yt_dlp
        except ImportError as exc:
            raise RuntimeError(
                "yt-dlp is not installed. Run: pip install yt-dlp"
            ) from exc
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except Exception as exc:
            raise RuntimeError(str(exc)) from exc
        if info is None:
            raise RuntimeError("yt-dlp returned no info for this URL")
        # Unwrap single-entry playlists
        if info.get("_type") == "playlist":
            entries = list(info.get("entries") or [])
            if not entries:
                raise RuntimeError("Playlist is empty")
            info = entries[0]
        return info

    @staticmethod
    def _pick_url(info: dict) -> str:
        url = info.get("url") or info.get("manifest_url")
        if not url:
            raise RuntimeError(
                "Could not extract a direct stream URL. "
                "The content may be private, age-restricted, or require login."
            )
        return url
