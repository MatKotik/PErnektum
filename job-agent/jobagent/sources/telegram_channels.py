"""Публичные Telegram-каналы с вакансиями. Читаем веб-превью t.me/s/<канал> — без аккаунта и ключей."""

from __future__ import annotations

import logging
import re
from html.parser import HTMLParser

from ..util import parse_date, truncate
from .base import Source, SourceConfigError, register

log = logging.getLogger(__name__)

_HASHTAG_RE = re.compile(r"#[\w]+", re.UNICODE)


class _ChannelPageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.posts: list[dict] = []
        self._post: dict | None = None
        self._capture_depth = 0
        self._chunks: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class") or ""
        if tag == "div" and a.get("data-post") and "js-widget_message" in cls:
            self._finish_text()
            self._post = {"post": a["data-post"], "text": "", "date": ""}
            self.posts.append(self._post)
            return
        if self._post is None:
            return
        if self._capture_depth:
            if tag == "div":
                self._capture_depth += 1
            elif tag == "br":
                self._chunks.append("\n")
            return
        if tag == "div" and "js-message_text" in cls and not self._post["text"]:
            self._capture_depth = 1
            self._chunks = []
        elif tag == "time" and a.get("datetime") and not self._post["date"]:
            self._post["date"] = a["datetime"]

    def handle_startendtag(self, tag, attrs):
        if tag == "br" and self._capture_depth:
            self._chunks.append("\n")
        else:
            self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if self._capture_depth and tag == "div":
            self._capture_depth -= 1
            if self._capture_depth == 0:
                self._finish_text()

    def handle_data(self, data):
        if self._capture_depth:
            self._chunks.append(data)

    def _finish_text(self):
        if self._post is not None and self._chunks:
            text = "".join(self._chunks)
            lines = [" ".join(line.split()) for line in text.split("\n")]
            self._post["text"] = "\n".join(line for line in lines if line)
        self._chunks = []
        self._capture_depth = 0


def parse_channel_page(html_text: str) -> list[dict]:
    parser = _ChannelPageParser()
    parser.feed(html_text)
    parser.close()
    parser._finish_text()
    return [p for p in parser.posts if p.get("text")]


def _title_from_text(text: str) -> str:
    for line in text.split("\n"):
        clean = _HASHTAG_RE.sub("", line).strip(" -—–|•·:")
        if len(clean) >= 4:
            return truncate(clean, 120)
    return truncate(text.replace("\n", " "), 120)


def _channel_name(raw: str) -> str:
    raw = raw.strip()
    raw = re.sub(r"^(https?://)?(t\.me|telegram\.me)/(s/)?", "", raw)
    return raw.lstrip("@").strip("/")


@register
class TelegramChannels(Source):
    kind = "telegram"
    title = "Telegram"
    default_interval = 20

    def check_ready(self):
        if not self.options.get("channels"):
            raise SourceConfigError("список channels пуст")

    def fetch(self):
        out = []
        errors = []
        channels = [_channel_name(c) for c in self.options.get("channels") or []]
        for channel in channels:
            try:
                page = self.http.get_text(f"https://t.me/s/{channel}")
            except Exception as exc:  # один битый канал не должен ронять остальные
                errors.append(f"{channel}: {exc}")
                continue
            posts = parse_channel_page(page)
            if not posts:
                errors.append(f"{channel}: нет постов (канал приватный или не существует?)")
            for p in posts:
                text = p["text"]
                out.append(self.vacancy(
                    id=p["post"],
                    title=_title_from_text(text),
                    url=f"https://t.me/{p['post']}",
                    location="",
                    description=text,
                    tags=_HASHTAG_RE.findall(text)[:10],
                    published=parse_date(p["date"]),
                    source_title=f"Telegram @{p['post'].split('/')[0]}",
                ))
        if errors:
            log.warning("telegram: %s", "; ".join(errors))
            if not out:
                raise RuntimeError("; ".join(errors))
        return out
