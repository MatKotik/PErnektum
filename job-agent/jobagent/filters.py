"""Критерии отбора вакансий. Пока критерии пустые — пропускается всё."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from .models import Vacancy

DEFAULT_SEARCH_IN = ["title", "tags", "description", "company"]
DEFAULT_EXCLUDE_IN = ["title", "company"]


def _norm(text: str) -> str:
    return text.lower().replace("ё", "е")


def _compile(word: str) -> re.Pattern:
    word = _norm(word.strip())
    escaped = re.escape(word)
    # Короткие слова (go, js, qa, 1с) ищем целиком, иначе "go" найдётся в "google".
    # Длинные — по подстроке, чтобы "разработчик" находил "разработчика".
    if len(word) <= 3:
        return re.compile(rf"(?<![\w]){escaped}(?![\w])")
    return re.compile(escaped)


@dataclass
class Filters:
    keywords: list[str] = field(default_factory=list)
    exclude_keywords: list[str] = field(default_factory=list)
    search_in: list[str] = field(default_factory=lambda: list(DEFAULT_SEARCH_IN))
    exclude_in: list[str] = field(default_factory=lambda: list(DEFAULT_EXCLUDE_IN))
    remote_only: bool = False
    require_salary: bool = False
    max_age_days: float | None = 7

    def __post_init__(self):
        self._include = [_compile(w) for w in self.keywords if w and w.strip()]
        self._exclude = [_compile(w) for w in self.exclude_keywords if w and w.strip()]

    @classmethod
    def from_config(cls, cfg: dict | None) -> "Filters":
        cfg = cfg or {}
        return cls(
            keywords=list(cfg.get("keywords") or []),
            exclude_keywords=list(cfg.get("exclude_keywords") or []),
            search_in=list(cfg.get("search_in") or DEFAULT_SEARCH_IN),
            exclude_in=list(cfg.get("exclude_in") or DEFAULT_EXCLUDE_IN),
            remote_only=bool(cfg.get("remote_only", False)),
            require_salary=bool(cfg.get("require_salary", False)),
            max_age_days=cfg.get("max_age_days", 7),
        )

    def rejection_reason(self, v: Vacancy, now: datetime | None = None) -> str | None:
        """None — вакансия подходит; иначе короткая причина отказа (для логов)."""
        if self.max_age_days and v.published:
            now = now or datetime.now(timezone.utc)
            if now - v.published > timedelta(days=float(self.max_age_days)):
                return "старая"
        if self.remote_only and v.remote is False:
            return "не удалёнка"
        if self.require_salary and not v.salary:
            return "без зарплаты"
        if self._exclude:
            text = _norm(v.search_text(self.exclude_in))
            if any(p.search(text) for p in self._exclude):
                return "стоп-слово"
        if self._include:
            text = _norm(v.search_text(self.search_in))
            if not any(p.search(text) for p in self._include):
                return "нет ключевых слов"
        return None

    def matches(self, v: Vacancy, now: datetime | None = None) -> bool:
        return self.rejection_reason(v, now) is None
