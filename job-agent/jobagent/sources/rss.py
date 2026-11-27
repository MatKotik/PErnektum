"""RSS/Atom: универсальный источник + готовые настройки для конкретных сайтов."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

from ..util import html_to_text, parse_date
from .base import Source, SourceConfigError, register


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower() if isinstance(tag, str) else ""


def _child_text(el: ET.Element, *names: str) -> str:
    for child in el:
        if _local(child.tag) in names:
            text = "".join(child.itertext()).strip()
            if text:
                return text
    return ""


def parse_feed(xml_text: str) -> list[dict]:
    """Разбирает RSS 2.0 / RSS 1.0 / Atom в список словарей с одинаковыми ключами."""
    xml_text = xml_text.lstrip("﻿ \r\n\t")
    root = ET.fromstring(xml_text.encode("utf-8") if isinstance(xml_text, str) else xml_text)
    entries = [el for el in root.iter() if _local(el.tag) in ("item", "entry")]
    out = []
    for el in entries:
        link = ""
        for child in el:
            if _local(child.tag) == "link":
                href = child.get("href")
                if href and child.get("rel", "alternate") == "alternate":
                    link = href
                    break
                if (child.text or "").strip():
                    link = child.text.strip()
                    break
        categories = []
        for child in el:
            if _local(child.tag) == "category":
                value = (child.text or child.get("term") or "").strip()
                if value:
                    categories.append(value)
        extra = {_local(c.tag): "".join(c.itertext()).strip() for c in el
                 if _local(c.tag) not in ("title", "link", "description", "category")}
        out.append({
            "title": html_to_text(_child_text(el, "title")),
            "link": link,
            "guid": _child_text(el, "guid", "id") or link,
            "published": _child_text(el, "pubdate", "published", "updated", "date"),
            "description": _child_text(el, "description", "summary", "content", "encoded"),
            "author": _child_text(el, "author", "creator"),
            "categories": categories,
            "extra": extra,
        })
    return out


@register
class RssSource(Source):
    """Любая RSS/Atom-лента. В url можно вставить {query} — подставится поисковый запрос."""

    kind = "rss"
    title = "RSS"
    default_interval = 30
    url_template = ""

    def __init__(self, http, options=None, query="", name=None):
        super().__init__(http, options, query, name)
        self.url_template = self.options.get("url") or self.url_template
        if self.options.get("title"):
            self.title = self.options["title"]

    def feed_url(self) -> str:
        if not self.url_template:
            raise SourceConfigError("не указан url ленты")
        return self.url_template.replace("{query}", self.q)

    def fetch(self):
        items = parse_feed(self.http.get_text(self.feed_url()))
        return [v for v in (self.convert(item) for item in items[: self.limit]) if v]

    def convert(self, item: dict):
        if not item["title"] or not item["link"]:
            return None
        return self.vacancy(
            id=item["guid"] or item["link"],
            title=item["title"],
            url=item["link"],
            company=html_to_text(item["author"]),
            description=html_to_text(item["description"]),
            tags=item["categories"],
            published=parse_date(item["published"]),
        )


@register
class HabrCareer(RssSource):
    kind = "habr_career"
    title = "Хабр Карьера"
    default_interval = 20
    url_template = "https://career.habr.com/vacancies/rss?q={query}&sort=date&type=all"

    # заголовок в ленте: Требуется «Инженер ЦОД» (Ногинск, от 90 000 до 130 000 ₽)
    _TITLE_RE = re.compile(r"^Требуется\s+«(?P<title>.+)»\s*(?:\((?P<extra>.*)\))?\s*$")
    _SALARY_RE = re.compile(r"^(от|до)\s|[₽$€]|руб", re.IGNORECASE)

    def feed_url(self) -> str:
        url = super().feed_url()
        if self.options.get("remote"):
            url += "&remote=true"
        return url

    def convert(self, item):
        v = super().convert(item)
        if v:
            m = self._TITLE_RE.match(v.title)
            if m:
                v.title = m.group("title").strip()
                parts = [p.strip() for p in (m.group("extra") or "").split(", ") if p.strip()]
                v.salary = ", ".join(p for p in parts if self._SALARY_RE.search(p))
                v.location = ", ".join(p for p in parts if not self._SALARY_RE.search(p))
            v.remote = "удал" in f"{v.location} {v.description}".lower()
        return v


@register
class WeWorkRemotely(RssSource):
    kind = "weworkremotely"
    title = "We Work Remotely"
    default_interval = 30
    url_template = "https://weworkremotely.com/remote-jobs.rss"

    def convert(self, item):
        v = super().convert(item)
        if v and ": " in v.title:  # заголовок вида "Company: Position"
            v.company, v.title = (part.strip() for part in v.title.split(": ", 1))
        if v:
            v.location = item["extra"].get("region") or "Remote"
            v.remote = True
        return v


@register
class Dou(RssSource):
    kind = "dou"
    title = "DOU"
    default_interval = 30
    url_template = "https://jobs.dou.ua/vacancies/feeds/?search={query}"

    _TITLE_RE = re.compile(r"^(?P<title>.+?) в (?P<company>[^,]+)(?:, (?P<loc>.+))?$")

    def convert(self, item):
        v = super().convert(item)
        if v:
            m = self._TITLE_RE.match(v.title)
            if m:
                v.title, v.company = m.group("title"), m.group("company").strip()
                v.location = (m.group("loc") or "").strip()
        return v
