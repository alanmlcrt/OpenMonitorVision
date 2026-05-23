"""
NotifyNode — channel-agnostic notification.

Fires only when the upstream Event Trigger node has populated `context.events`
(i.e. once per event burst, throttled by the trigger's cooldown). The node
ships one notification per upstream-frame containing every event of that
frame; templating is applied per-event for subject/body/topic/payload.

Config:
    channel : 'webhook' | 'email' | 'mqtt'

    # webhook
    webhook_url        str
    webhook_method     str   POST (default) | PUT
    webhook_headers    str   JSON string (optional)

    # email
    smtp_host          str
    smtp_port          int   587 (default)
    smtp_user          str
    smtp_password      str
    smtp_use_tls       bool  STARTTLS (587)
    smtp_use_ssl       bool  SMTPS    (465)
    from_addr          str
    to_addrs           str   comma-separated
    subject_template   str   default "OpenMonitorVision: {class_name}"
    body_template      str   default plain-text dump

    # mqtt
    broker_id          int
    topic_template     str   default "omv/workflow/{workflow_id}/events"
    payload_template   str   if empty → full JSON event payload
    qos                int
    retain             bool
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

from app.core.logging import get_logger
from app.db.database import AsyncSessionLocal
from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext
from app.services import mqtt_service, notification_service
from app.services.notification_service import (
    build_event_payload,
    build_template_context,
    render_template,
)

logger = get_logger(__name__)


class NotifyNode(BaseNode):
    type = "notify"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config") or {}
        events = context.events or []
        if not events:
            return {}

        channel = (config.get("channel") or "webhook").lower()

        try:
            if channel == "webhook":
                await self._send_webhook(context, config, events)
            elif channel == "email":
                await self._send_email(context, config, events)
            elif channel == "mqtt":
                await self._send_mqtt(context, config, events)
            elif channel == "telegram":
                await self._send_telegram(context, config, events)
            else:
                logger.warning("notify_node: unknown channel '%s'", channel)
        except Exception as exc:
            logger.warning("notify_node[%s] error: %s", channel, exc)
        return {}

    # ── Webhook ─────────────────────────────────────────────────────────────

    async def _send_webhook(self, ctx: WorkflowContext, config: dict, events: list[dict]) -> None:
        url = (config.get("webhook_url") or "").strip()
        if not url:
            return
        method = (config.get("webhook_method") or "POST").upper()

        # Optional custom headers as JSON string
        headers: dict[str, str] | None = None
        raw_headers = config.get("webhook_headers")
        if isinstance(raw_headers, str) and raw_headers.strip():
            try:
                parsed = json.loads(raw_headers)
                if isinstance(parsed, dict):
                    headers = {str(k): str(v) for k, v in parsed.items()}
            except json.JSONDecodeError:
                logger.warning("notify_node[webhook]: invalid JSON in headers, ignored")

        payload = build_event_payload(ctx.workflow_id, ctx.source_id, events)
        ok, msg = await notification_service.send_webhook(url, payload, method=method, headers=headers)
        if not ok:
            logger.warning("notify_node[webhook]: %s", msg)

    # ── Email ───────────────────────────────────────────────────────────────

    async def _send_email(self, ctx: WorkflowContext, config: dict, events: list[dict]) -> None:
        smtp_host = (config.get("smtp_host") or "").strip()
        from_addr = (config.get("from_addr") or "").strip()
        to_raw = (config.get("to_addrs") or "").strip()
        to_addrs = [a.strip() for a in to_raw.split(",") if a.strip()]
        if not smtp_host or not from_addr or not to_addrs:
            return

        # Template uses the *first* event for context; the body lists them all
        first = events[0]
        tctx = build_template_context(first, ctx.workflow_id, ctx.source_id)

        subject_tpl = config.get("subject_template") or "OpenMonitorVision: {class_name}"
        body_tpl = config.get("body_template") or ""

        subject = render_template(subject_tpl, tctx)
        if body_tpl:
            body = render_template(body_tpl, tctx)
        else:
            lines = [
                f"Workflow #{ctx.workflow_id} fired {len(events)} event(s):",
                "",
            ]
            for i, ev in enumerate(events, 1):
                conf = ev.get("confidence")
                conf_s = f" ({conf*100:.0f}%)" if isinstance(conf, (int, float)) else ""
                lines.append(
                    f"  {i}. {ev.get('class_name')}{conf_s}"
                    f"{' in ' + ev['zone_name'] if ev.get('zone_name') else ''}"
                    f"{' [#' + str(ev['tracker_id']) + ']' if ev.get('tracker_id') is not None else ''}"
                )
            body = "\n".join(lines)

        ok, msg = await notification_service.send_email(
            smtp_host=smtp_host,
            smtp_port=int(config.get("smtp_port") or 587),
            smtp_user=(config.get("smtp_user") or None),
            smtp_password=(config.get("smtp_password") or None),
            use_tls=bool(config.get("smtp_use_tls", True)),
            use_ssl=bool(config.get("smtp_use_ssl", False)),
            from_addr=from_addr,
            to_addrs=to_addrs,
            subject=subject,
            body=body,
        )
        if not ok:
            logger.warning("notify_node[email]: %s", msg)

    # ── Telegram ────────────────────────────────────────────────────────────

    async def _send_telegram(self, ctx: WorkflowContext, config: dict, events: list[dict]) -> None:
        bot_token = (config.get("telegram_bot_token") or "").strip()
        chat_id = (config.get("telegram_chat_id") or "").strip()
        if not bot_token or not chat_id:
            return

        first = events[0]
        tctx = build_template_context(first, ctx.workflow_id, ctx.source_id)

        body_tpl = config.get("telegram_message_template") or ""
        if body_tpl:
            text = render_template(body_tpl, tctx)
        else:
            lines = [f"🔔 OpenMonitorVision — workflow #{ctx.workflow_id}"]
            for i, ev in enumerate(events, 1):
                conf = ev.get("confidence")
                conf_s = f" ({conf*100:.0f}%)" if isinstance(conf, (int, float)) else ""
                zone = f" in {ev['zone_name']}" if ev.get("zone_name") else ""
                tid = f" #{ev['tracker_id']}" if ev.get("tracker_id") is not None else ""
                lines.append(f"{i}. {ev.get('class_name')}{conf_s}{zone}{tid}")
            text = "\n".join(lines)

        parse_mode = (config.get("telegram_parse_mode") or "").strip() or None
        ok, msg = await notification_service.send_telegram(
            bot_token, chat_id, text, parse_mode=parse_mode
        )
        if not ok:
            logger.warning("notify_node[telegram]: %s", msg)

    # ── MQTT ────────────────────────────────────────────────────────────────

    async def _send_mqtt(self, ctx: WorkflowContext, config: dict, events: list[dict]) -> None:
        try:
            broker_id = int(config.get("broker_id") or 0)
        except (TypeError, ValueError):
            return
        if broker_id <= 0:
            return

        topic_tpl = config.get("topic_template") or "omv/workflow/{workflow_id}/events"
        payload_tpl = config.get("payload_template") or ""
        qos = int(config.get("qos") or 0)
        retain = bool(config.get("retain", False))

        # Load broker once (off the request lifecycle)
        async with AsyncSessionLocal() as db:
            broker = await mqtt_service.get_broker(db, broker_id)
        if broker is None:
            logger.warning("notify_node[mqtt]: broker %s not found", broker_id)
            return

        # One publish per event so JSON consumers can map to single objects easily
        for ev in events:
            tctx = build_template_context(ev, ctx.workflow_id, ctx.source_id)
            topic = render_template(topic_tpl, tctx).strip()
            if not topic:
                continue
            if payload_tpl:
                payload_str = render_template(payload_tpl, tctx)
            else:
                payload_str = json.dumps({
                    "workflow_id": ctx.workflow_id,
                    "source_id": ctx.source_id,
                    "event": ev,
                })
            ok = await mqtt_service.publish_async(broker, topic, payload_str, qos=qos, retain=retain)
            if not ok:
                logger.warning("notify_node[mqtt]: publish to %s failed", topic)
