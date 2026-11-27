"""Куда агент «кидает» найденные вакансии: Telegram или просто в консоль."""

from __future__ import annotations

import html
import logging
import time

import requests

from .models import Vacancy
from .util import join_nonempty, truncate

log = logging.getLogger(__name__)

TELEGRAM_LIMIT = 4096


def esc(text: str) -> str:
    return html.escape(text or "", quote=False)


def format_vacancy(v: Vacancy, snippet_len: int = 350) -> str:
    lines = [f"<b>{esc(v.title)}</b>"]
    meta = join_nonempty(
        f"🏢 {esc(v.company)}" if v.company else "",
        f"📍 {esc(v.location)}" if v.location else "",
        f"💰 {esc(v.salary)}" if v.salary else "",
        sep="  ·  ",
    )
    if meta:
        lines.append(meta)
    if v.match_hint:
        lines.append("✅ " + esc(v.match_hint))
    if v.tags:
        lines.append("🏷 " + esc(", ".join(v.tags[:8])))
    if v.description and snippet_len > 0:
        lines.append("")
        lines.append(esc(truncate(v.description.replace("\n", " "), snippet_len)))
    lines.append("")
    date = v.published.strftime("%d.%m %H:%M UTC") if v.published else ""
    footer = join_nonempty(f'<a href="{html.escape(v.url, quote=True)}">Открыть вакансию</a>',
                           esc(v.source_title or v.source), esc(date), sep="  ·  ")
    lines.append(footer)
    return "\n".join(lines)[:TELEGRAM_LIMIT]


class Notifier:
    name = "base"

    def send_text(self, text: str) -> None:  # pragma: no cover - интерфейс
        raise NotImplementedError

    def send_vacancy(self, v: Vacancy, snippet_len: int = 350) -> None:
        self.send_text(format_vacancy(v, snippet_len))


class ConsoleNotifier(Notifier):
    """Режим без Telegram: печатает то, что было бы отправлено."""

    name = "console"

    def __init__(self):
        self.sent: list[str] = []

    def send_text(self, text: str) -> None:
        self.sent.append(text)
        print("─" * 60)
        print(text)


class TelegramError(RuntimeError):
    pass


class TelegramNotifier(Notifier):
    name = "telegram"

    def __init__(self, token: str, chat_id: str, delay: float = 1.1, timeout: float = 20):
        self._token = token
        self.chat_id = chat_id
        self.delay = delay  # Telegram не любит больше ~1 сообщения в секунду в один чат
        self.timeout = timeout
        self._last = 0.0
        self.session = requests.Session()

    def _hide(self, text: str) -> str:
        return text.replace(self._token, "***") if self._token else text

    def _call(self, method: str, payload: dict) -> dict:
        url = f"https://api.telegram.org/bot{self._token}/{method}"
        for attempt in range(4):
            wait = self.delay - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            try:
                resp = self.session.post(url, json=payload, timeout=self.timeout)
            except requests.RequestException as exc:
                if attempt < 3:
                    time.sleep(3 * (attempt + 1))
                    continue
                raise TelegramError(self._hide(f"сеть: {exc}")) from None
            finally:
                self._last = time.monotonic()
            try:
                data = resp.json()
            except ValueError:
                data = {"ok": False, "description": resp.text[:200]}
            if data.get("ok"):
                return data
            retry_after = (data.get("parameters") or {}).get("retry_after")
            if resp.status_code == 429 and retry_after and attempt < 3:
                time.sleep(min(float(retry_after), 60) + 1)
                continue
            raise TelegramError(self._hide(f"{resp.status_code}: {data.get('description')}"))
        raise TelegramError("Telegram не принял сообщение после нескольких попыток")

    def send_text(self, text: str) -> None:
        self._call("sendMessage", {
            "chat_id": self.chat_id,
            "text": text[:TELEGRAM_LIMIT],
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        })
