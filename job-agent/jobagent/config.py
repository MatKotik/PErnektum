"""Чтение config.yaml и сборка списка источников."""

from __future__ import annotations

import logging
import os
from pathlib import Path

import yaml

from .http import HttpClient
from .sources import REGISTRY, Source
from .sources.rss import RssSource

log = logging.getLogger(__name__)


def deep_merge(base: dict, extra: dict) -> dict:
    result = dict(base)
    for key, value in (extra or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_config(path: str | Path) -> dict:
    cfg = yaml.safe_load(Path(path).read_text("utf-8")) or {}
    # Критерии можно держать не в публичном репозитории, а в секрете GitHub:
    # JOB_AGENT_OVERRIDES — YAML, который накладывается поверх config.yaml.
    overrides = os.environ.get("JOB_AGENT_OVERRIDES", "").strip()
    if overrides:
        extra = yaml.safe_load(overrides) or {}
        if not isinstance(extra, dict):
            raise ValueError("JOB_AGENT_OVERRIDES должен быть YAML-словарём")
        cfg = deep_merge(cfg, extra)
        log.info("Применены настройки из JOB_AGENT_OVERRIDES")
    return cfg


def build_sources(cfg: dict, http: HttpClient) -> list[Source]:
    query = ((cfg.get("search") or {}).get("query")) or ""
    default_interval = (cfg.get("agent") or {}).get("interval_minutes")
    sources: list[Source] = []
    for kind, options in (cfg.get("sources") or {}).items():
        options = dict(options or {})
        if not options.get("enabled", True):
            continue
        if default_interval and "interval_minutes" not in options:
            cls = REGISTRY.get(kind)
            # общий интервал не делает опрос чаще, чем просит сам сайт
            if cls and default_interval > cls.default_interval:
                options["interval_minutes"] = default_interval
        if kind == "rss":
            for feed in options.get("feeds") or []:
                feed = dict(feed)
                if not feed.get("enabled", True) or not feed.get("url"):
                    continue
                name = f"rss:{feed.get('name') or feed['url']}"
                feed.setdefault("interval_minutes", options.get("interval_minutes"))
                sources.append(RssSource(http, feed, query, name=name))
            continue
        cls = REGISTRY.get(kind)
        if cls is None:
            log.warning("Неизвестный источник в config.yaml: %s (пропускаю)", kind)
            continue
        sources.append(cls(http, options, query))
    return sources
