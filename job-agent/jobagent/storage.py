"""Память агента: какие вакансии уже отправлены, когда опрашивался каждый сайт."""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from pathlib import Path

log = logging.getLogger(__name__)

DAY = 86400


class State:
    VERSION = 1

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.seen: dict[str, float] = {}          # "source:id" -> когда отправили
        self.fingerprints: dict[str, float] = {}  # отпечаток (название+компания) -> когда
        self.sources: dict[str, dict] = {}        # служебная информация по источникам
        self.started_notice_sent = False
        self.is_new = True

    # ---------- загрузка / сохранение ----------
    def load(self) -> "State":
        if not self.path.exists():
            log.info("Файл состояния %s не найден — первый запуск", self.path)
            return self
        try:
            data = json.loads(self.path.read_text("utf-8"))
        except (OSError, ValueError) as exc:
            log.warning("Не удалось прочитать %s (%s), начинаю с чистого листа", self.path, exc)
            return self
        self.seen = {k: float(v) for k, v in data.get("seen", {}).items()}
        self.fingerprints = {k: float(v) for k, v in data.get("fingerprints", {}).items()}
        self.sources = data.get("sources", {})
        self.started_notice_sent = bool(data.get("started_notice_sent", False))
        self.is_new = False
        return self

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "version": self.VERSION,
            "saved_at": time.time(),
            "started_notice_sent": self.started_notice_sent,
            "sources": self.sources,
            "seen": self.seen,
            "fingerprints": self.fingerprints,
        }
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".state-", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, self.path)

    def prune(self, keep_days: int) -> None:
        border = time.time() - keep_days * DAY
        self.seen = {k: v for k, v in self.seen.items() if v >= border}
        self.fingerprints = {k: v for k, v in self.fingerprints.items() if v >= border}

    # ---------- вакансии ----------
    def is_seen(self, key: str, fingerprint: str | None = None) -> bool:
        return key in self.seen or (fingerprint is not None and fingerprint in self.fingerprints)

    def mark_seen(self, key: str, fingerprint: str | None = None, when: float | None = None) -> None:
        now = when or time.time()
        self.seen[key] = now
        if fingerprint:
            self.fingerprints[fingerprint] = now

    # ---------- источники ----------
    def source(self, name: str) -> dict:
        return self.sources.setdefault(name, {})

    def is_source_initialized(self, name: str) -> bool:
        return bool(self.source(name).get("initialized"))

    def due(self, name: str, interval_minutes: float, now: float | None = None) -> bool:
        last = self.source(name).get("last_run", 0)
        # небольшой запас, чтобы задержки cron не заставляли пропускать запуск
        return (now or time.time()) - last >= interval_minutes * 60 - 90

    def record_success(self, name: str, fetched: int) -> None:
        info = self.source(name)
        info.update(last_run=time.time(), last_ok=time.time(), last_count=fetched,
                    failures=0, initialized=True, alerted=False)
        info.pop("last_error", None)

    def record_failure(self, name: str, error: str) -> int:
        info = self.source(name)
        info["last_run"] = time.time()
        info["failures"] = int(info.get("failures", 0)) + 1
        info["last_error"] = error[:300]
        return info["failures"]
