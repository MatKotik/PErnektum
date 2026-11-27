"""Единая модель вакансии, в которую каждый источник переводит свои данные."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime


def _normalize(text: str) -> str:
    text = text.lower().replace("ё", "е")
    text = re.sub(r"[^\w]+", " ", text)
    return " ".join(text.split())


@dataclass
class Vacancy:
    source: str          # код источника, например "remoteok"
    id: str              # id вакансии внутри источника
    title: str
    url: str
    company: str = ""
    location: str = ""
    salary: str = ""
    description: str = ""  # уже очищенный от HTML текст
    tags: list[str] = field(default_factory=list)
    published: datetime | None = None  # всегда timezone-aware (UTC), если известно
    remote: bool | None = None
    source_title: str = ""  # человекочитаемое имя источника для сообщения
    match_hint: str = ""    # что именно совпало с критериями (показываем в сообщении)

    @property
    def key(self) -> str:
        return f"{self.source}:{self.id}"

    @property
    def fingerprint(self) -> str:
        """Отпечаток для склейки одной и той же вакансии с разных сайтов."""
        base = f"{_normalize(self.title)}|{_normalize(self.company)}"
        return hashlib.sha1(base.encode("utf-8")).hexdigest()[:16]

    def search_text(self, fields: list[str]) -> str:
        parts: list[str] = []
        for name in fields:
            if name == "tags":
                parts.extend(self.tags)
            else:
                parts.append(str(getattr(self, name, "") or ""))
        return " \n".join(parts)
