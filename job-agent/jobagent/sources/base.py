"""Базовый класс источника и реестр всех сайтов, которые умеет опрашивать агент."""

from __future__ import annotations

import os
from typing import ClassVar
from urllib.parse import quote_plus

from ..http import HttpClient
from ..models import Vacancy

REGISTRY: dict[str, type["Source"]] = {}


def register(cls: type["Source"]) -> type["Source"]:
    REGISTRY[cls.kind] = cls
    return cls


class SourceConfigError(RuntimeError):
    """Источник включён, но не настроен (нет ключа, пустой список каналов и т.п.)."""


class Source:
    kind: ClassVar[str] = "base"          # ключ в config.yaml
    title: ClassVar[str] = "Base"         # как показывать в сообщениях
    default_interval: ClassVar[int] = 20  # минут между опросами
    env_required: ClassVar[tuple[str, ...]] = ()  # нужные переменные окружения (ключи API)

    def __init__(self, http: HttpClient, options: dict | None = None, query: str = "",
                 name: str | None = None):
        self.http = http
        self.options = dict(options or {})
        self.query = (self.options.get("query") if self.options.get("query") is not None else query) or ""
        self.name = name or self.kind
        self.interval = float(self.options.get("interval_minutes") or self.default_interval)
        self.limit = int(self.options.get("limit") or 100)

    def env(self, key: str) -> str:
        value = os.environ.get(key, "").strip()
        if not value:
            raise SourceConfigError(f"не задан {key}")
        return value

    def check_ready(self) -> None:
        for key in self.env_required:
            self.env(key)

    def fetch(self) -> list[Vacancy]:  # pragma: no cover - интерфейс
        raise NotImplementedError

    # помощники для наследников
    def vacancy(self, **kwargs) -> Vacancy:
        kwargs.setdefault("source", self.name)
        kwargs.setdefault("source_title", self.title)
        kwargs["id"] = str(kwargs["id"])
        return Vacancy(**kwargs)

    @property
    def q(self) -> str:
        return quote_plus(self.query.strip())
