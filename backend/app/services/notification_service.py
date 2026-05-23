"""
Channel-agnostic notification helpers.

- webhook : POST JSON to a URL (stdlib urllib — no extra deps)
- email   : SMTP send with TLS or SSL (stdlib smtplib)
- mqtt    : delegated to mqtt_service

Templating: very small substitution helper that takes a dict and replaces
{key} placeholders, used for body / subject / topic templates.
"""
from __future__ import annotations

import asyncio
import json
import re
import smtplib
import ssl
import urllib.error
import urllib.request
from email.message import EmailMessage
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)


# ── Templating ──────────────────────────────────────────────────────────────

_VAR_RE = re.compile(r"\{(\w+)\}")


def render_template(template: str, context: dict[str, Any]) -> str:
    """Substitute {key} placeholders. Missing keys render as empty string."""
    if not template:
        return ""

    def replace(m: re.Match) -> str:
        key = m.group(1)
        val = context.get(key, "")
        if isinstance(val, float):
            return f"{val:.3f}"
        return str(val if val is not None else "")

    return _VAR_RE.sub(replace, template)


# ── Webhook ─────────────────────────────────────────────────────────────────

def _send_webhook_sync(
    url: str,
    payload: dict[str, Any],
    *,
    method: str = "POST",
    headers: dict[str, str] | None = None,
    timeout: float = 8.0,
) -> tuple[bool, str]:
    body = json.dumps(payload).encode("utf-8")
    hdrs = {"Content-Type": "application/json", "User-Agent": "OpenMonitorVision"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return (200 <= resp.status < 300), f"HTTP {resp.status}"
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code}"
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return False, str(exc)


async def send_webhook(
    url: str,
    payload: dict[str, Any],
    *,
    method: str = "POST",
    headers: dict[str, str] | None = None,
    timeout: float = 8.0,
) -> tuple[bool, str]:
    return await asyncio.to_thread(_send_webhook_sync, url, payload, method=method, headers=headers, timeout=timeout)


# ── Email ───────────────────────────────────────────────────────────────────

def _send_email_sync(
    *,
    smtp_host: str,
    smtp_port: int,
    smtp_user: str | None,
    smtp_password: str | None,
    use_tls: bool,
    use_ssl: bool,
    from_addr: str,
    to_addrs: list[str],
    subject: str,
    body: str,
    timeout: float = 12.0,
) -> tuple[bool, str]:
    if not to_addrs:
        return False, "No recipient"

    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_addrs)
    msg["Subject"] = subject
    msg.set_content(body)

    try:
        if use_ssl:
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=timeout, context=ctx) as s:
                if smtp_user:
                    s.login(smtp_user, smtp_password or "")
                s.send_message(msg)
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=timeout) as s:
                s.ehlo()
                if use_tls:
                    ctx = ssl.create_default_context()
                    s.starttls(context=ctx)
                    s.ehlo()
                if smtp_user:
                    s.login(smtp_user, smtp_password or "")
                s.send_message(msg)
        return True, f"Sent to {len(to_addrs)} recipient(s)"
    except (smtplib.SMTPException, OSError, TimeoutError) as exc:
        return False, str(exc)


async def send_email(**kwargs) -> tuple[bool, str]:
    return await asyncio.to_thread(_send_email_sync, **kwargs)


# ── Telegram ────────────────────────────────────────────────────────────────

def _send_telegram_sync(
    bot_token: str,
    chat_id: str,
    text: str,
    *,
    parse_mode: str | None = None,
    timeout: float = 8.0,
) -> tuple[bool, str]:
    if not bot_token or not chat_id:
        return False, "Missing bot_token or chat_id"
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload: dict[str, Any] = {"chat_id": chat_id, "text": text[:4096]}
    if parse_mode in ("Markdown", "MarkdownV2", "HTML"):
        payload["parse_mode"] = parse_mode
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return (200 <= resp.status < 300), f"HTTP {resp.status}"
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code}: {exc.read().decode('utf-8', 'ignore')[:200]}"
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return False, str(exc)


async def send_telegram(
    bot_token: str,
    chat_id: str,
    text: str,
    *,
    parse_mode: str | None = None,
    timeout: float = 8.0,
) -> tuple[bool, str]:
    return await asyncio.to_thread(
        _send_telegram_sync, bot_token, chat_id, text, parse_mode=parse_mode, timeout=timeout
    )


# ── Helpers used by the engine ──────────────────────────────────────────────

def build_event_payload(workflow_id: int, source_id: int | None, events: list[dict]) -> dict[str, Any]:
    """Standard JSON shape sent to webhooks / formatted into emails / mqtt."""
    return {
        "workflow_id": workflow_id,
        "source_id": source_id,
        "count": len(events),
        "events": events,
    }


def build_template_context(event: dict[str, Any], workflow_id: int, source_id: int | None) -> dict[str, Any]:
    """Variables available inside {placeholders} for subject / body / topic templates."""
    bbox = event.get("bbox") or {}
    context = {
        "class_name": event.get("class_name"),
        "class_id": event.get("class_id"),
        "confidence": event.get("confidence"),
        "tracker_id": event.get("tracker_id"),
        "zone_name": event.get("zone_name"),
        "workflow_id": workflow_id,
        "source_id": source_id,
        "bbox_x1": bbox.get("x1"),
        "bbox_y1": bbox.get("y1"),
        "bbox_x2": bbox.get("x2"),
        "bbox_y2": bbox.get("y2"),
    }
    for key, value in event.items():
        if key not in context and not isinstance(value, (dict, list, tuple)):
            context[key] = value
    return context
