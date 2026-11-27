"""Критерии отбора вакансий.

Как задаются слова:
  "разработчик"    — ищется по подстроке (найдёт и «разработчика»);
  "go", "qa"       — короткие (до 3 букв) ищутся только целым словом;
  "re:<регэксп>"   — регулярное выражение, если нужно что-то хитрее.
Регистр и ё/е не важны.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from .models import Vacancy

DEFAULT_SEARCH_IN = ["title", "tags", "description", "company"]
DEFAULT_EXCLUDE_IN = ["title", "company"]
DEFAULT_REMOTE_KEYWORDS = ["удален", "дистанц", "remote", "из дома", "work from home"]


def _norm(text: str) -> str:
    return text.lower().replace("ё", "е")


def _compile(word: str) -> re.Pattern:
    word = word.strip()
    if word.startswith("re:"):
        return re.compile(_norm(word[3:]))
    word = _norm(word)
    escaped = re.escape(word)
    # Короткие слова (go, js, qa, 1с) ищем целиком, иначе "go" найдётся в "google".
    # Длинные — по подстроке, чтобы "разработчик" находил "разработчика".
    if len(word) <= 3:
        return re.compile(rf"(?<![\w]){escaped}(?![\w])")
    return re.compile(escaped)


def _compile_all(words) -> list[re.Pattern]:
    return [_compile(str(w)) for w in words or [] if w is not None and str(w).strip()]


@dataclass
class Filters:
    keywords: list[str] = field(default_factory=list)
    keyword_groups: list[list[str]] = field(default_factory=list)
    exclude_keywords: list[str] = field(default_factory=list)
    exclude_title_keywords: list[str] = field(default_factory=list)
    search_in: list[str] = field(default_factory=lambda: list(DEFAULT_SEARCH_IN))
    exclude_in: list[str] = field(default_factory=lambda: list(DEFAULT_EXCLUDE_IN))
    remote_only: bool = False
    remote_keywords: list[str] = field(default_factory=lambda: list(DEFAULT_REMOTE_KEYWORDS))
    require_salary: bool = False
    max_age_days: float | None = 7

    def __post_init__(self):
        # keywords — это просто ещё одна группа «хотя бы одно из»
        groups = ([self.keywords] if self.keywords else []) + [g for g in self.keyword_groups if g]
        self._groups = [p for p in (_compile_all(g) for g in groups) if p]
        self._exclude = _compile_all(self.exclude_keywords)
        self._exclude_title = _compile_all(self.exclude_title_keywords)
        self._remote = _compile_all(self.remote_keywords)

    @classmethod
    def from_config(cls, cfg: dict | None) -> "Filters":
        cfg = cfg or {}
        return cls(
            keywords=list(cfg.get("keywords") or []),
            keyword_groups=[list(g or []) for g in cfg.get("keyword_groups") or []],
            exclude_keywords=list(cfg.get("exclude_keywords") or []),
            exclude_title_keywords=list(cfg.get("exclude_title_keywords") or []),
            search_in=list(cfg.get("search_in") or DEFAULT_SEARCH_IN),
            exclude_in=list(cfg.get("exclude_in") or DEFAULT_EXCLUDE_IN),
            remote_only=bool(cfg.get("remote_only", False)),
            remote_keywords=list(cfg.get("remote_keywords") or DEFAULT_REMOTE_KEYWORDS),
            require_salary=bool(cfg.get("require_salary", False)),
            max_age_days=cfg.get("max_age_days", 7),
        )

    def rejection_reason(self, v: Vacancy, now: datetime | None = None) -> str | None:
        """None — вакансия подходит; иначе короткая причина отказа (для логов)."""
        if self.max_age_days and v.published:
            now = now or datetime.now(timezone.utc)
            if now - v.published > timedelta(days=float(self.max_age_days)):
                return "старая"
        text = _norm(v.search_text(self.search_in))
        if self.remote_only:
            if v.remote is False:
                return "не удалёнка"
            # сайт не сообщил формат (Telegram, RSS) — ищем признаки удалёнки в тексте
            if v.remote is None and not any(p.search(text) for p in self._remote):
                return "не удалёнка"
        if self.require_salary and not v.salary:
            return "без зарплаты"
        if self._exclude_title and any(p.search(_norm(v.title)) for p in self._exclude_title):
            return "стоп-слово в названии"
        if self._exclude:
            ex_text = _norm(v.search_text(self.exclude_in))
            if any(p.search(ex_text) for p in self._exclude):
                return "стоп-слово"
        for group in self._groups:
            if not any(p.search(text) for p in group):
                return "нет ключевых слов"
        return None

    def hint(self, v: Vacancy, limit: int = 3) -> str:
        """Какие слова из критериев нашлись — чтобы было видно, почему вакансия прислана."""
        text = _norm(v.search_text(self.search_in))
        found: list[str] = []
        for group in self._groups:
            for p in group:
                m = p.search(text)
                if m and m.group(0).strip() not in found:
                    found.append(m.group(0).strip())
                if len(found) >= limit:
                    return " · ".join(found)
        return " · ".join(found)

    def matches(self, v: Vacancy, now: datetime | None = None) -> bool:
        return self.rejection_reason(v, now) is None
