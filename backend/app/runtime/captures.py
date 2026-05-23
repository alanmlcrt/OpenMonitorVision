"""
Custom capture objects that mimic the cv2.VideoCapture interface
(read, release, isOpened, get) for source types OpenCV can't open natively.

The runtime in stream_manager uses these via `cap.read()` and `cap.release()`,
so any object exposing the right methods works as a drop-in replacement.
"""
from __future__ import annotations

import glob
import os
import time
import urllib.request
import urllib.error
from typing import Any

import numpy as np


def _cv2():
    import cv2
    return cv2


# ─────────────────────────────────────────────────────────────────────────────
# HTTP snapshot poll
# ─────────────────────────────────────────────────────────────────────────────

class HttpPollCapture:
    """
    Periodically GET a URL that returns a single image (JPEG / PNG / WebP / BMP)
    and decode it via OpenCV. Spaces requests by `min_interval` seconds so a
    slow / rate-limited endpoint isn't hammered.

    The runtime loop already caps at settings.max_fps via asyncio.sleep, so we
    just need to not over-request.
    """

    DEFAULT_TIMEOUT = 8.0
    DEFAULT_MIN_INTERVAL = 0.1   # 10 req/s max

    # Common UA — some camera firmwares reject requests with no User-Agent
    _UA = "Mozilla/5.0 (OpenMonitorVision)"

    def __init__(self, url: str, *, timeout: float = DEFAULT_TIMEOUT, min_interval: float = DEFAULT_MIN_INTERVAL):
        self.url = url
        self.timeout = timeout
        self.min_interval = min_interval
        self._last_request_ts = 0.0
        self._opened = False

        # Probe once so the runtime's `if cap is None` check works
        try:
            req = urllib.request.Request(url, headers={"User-Agent": self._UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                if r.status >= 400:
                    return
                # Read a few bytes to confirm the body is reachable, then discard
                r.read(1024)
            self._opened = True
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
            self._opened = False

    def isOpened(self) -> bool:
        return self._opened

    def read(self) -> tuple[bool, Any]:
        if not self._opened:
            return False, None

        # Rate-limit
        now = time.monotonic()
        wait = self.min_interval - (now - self._last_request_ts)
        if wait > 0:
            time.sleep(wait)

        try:
            req = urllib.request.Request(self.url, headers={"User-Agent": self._UA})
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                self._last_request_ts = time.monotonic()
                if resp.status != 200:
                    return False, None
                payload = resp.read()
            buf = np.frombuffer(payload, dtype=np.uint8)
            cv2 = _cv2()
            frame = cv2.imdecode(buf, cv2.IMREAD_COLOR)
            if frame is None:
                return False, None
            return True, frame
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
            return False, None

    def release(self) -> None:
        self._opened = False

    def get(self, prop: int) -> float:
        # cv2.VideoCapture.get(CAP_PROP_FPS) etc. — we report 0 (unknown)
        return 0.0


# ─────────────────────────────────────────────────────────────────────────────
# Image folder (sequence)
# ─────────────────────────────────────────────────────────────────────────────

class ImageFolderCapture:
    """
    Read every image file from a directory in lexicographic order, looping at
    end of sequence. The runtime's max_fps governs playback speed.

    `loop=False` would cause read() to return (False, None) after the last image,
    making the workflow stop naturally — useful for batch processing.
    """

    _EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

    def __init__(self, folder: str, *, loop: bool = True):
        self.folder = folder
        self.loop = loop
        self._files: list[str] = []
        self._idx = 0
        self._opened = False

        if not os.path.isdir(folder):
            return
        # Sort lexicographically — also supports glob-style "*.jpg" patterns
        try:
            entries = sorted(
                p for p in glob.iglob(os.path.join(folder, "*"))
                if os.path.isfile(p) and os.path.splitext(p)[1].lower() in self._EXT
            )
        except OSError:
            return
        if not entries:
            return
        self._files = entries
        self._opened = True

    def isOpened(self) -> bool:
        return self._opened

    def read(self) -> tuple[bool, Any]:
        if not self._opened or not self._files:
            return False, None
        if self._idx >= len(self._files):
            if not self.loop:
                return False, None
            self._idx = 0
        path = self._files[self._idx]
        self._idx += 1
        try:
            cv2 = _cv2()
            frame = cv2.imread(path)
            if frame is None:
                # Skip the bad file, try the next
                return self.read()
            return True, frame
        except Exception:
            return False, None

    def release(self) -> None:
        self._opened = False
        self._files = []

    def get(self, prop: int) -> float:
        return 0.0
