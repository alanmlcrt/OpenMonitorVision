from .base import PlatformMeta, StreamResolver
from .youtube import YouTubeResolver
from .twitch import TwitchResolver
from .generic import GenericResolver, meta_for_url

# Ordered list: specific resolvers first, generic last
_RESOLVERS: list[type[StreamResolver]] = [
    YouTubeResolver,
    TwitchResolver,
    GenericResolver,
]


def get_resolver(url: str) -> type[StreamResolver] | None:
    for cls in _RESOLVERS:
        if cls.matches(url):
            return cls
    return None


def get_meta(url: str) -> PlatformMeta:
    if YouTubeResolver.matches(url):
        return YouTubeResolver.meta
    if TwitchResolver.matches(url):
        return TwitchResolver.meta
    return meta_for_url(url)


__all__ = [
    "YouTubeResolver",
    "TwitchResolver",
    "GenericResolver",
    "get_resolver",
    "get_meta",
    "PlatformMeta",
    "StreamResolver",
]
