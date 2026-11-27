"""Один цикл работы агента: опросить сайты → отфильтровать → убрать дубли → отправить."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

from .filters import Filters
from .models import Vacancy
from .notify import Notifier, TelegramError, esc
from .sources import Source, SourceConfigError
from .storage import State

log = logging.getLogger(__name__)


@dataclass
class SourceReport:
    name: str
    status: str = "ok"      # ok | skipped | not_configured | error | bootstrap
    fetched: int = 0
    matched: int = 0
    new: int = 0
    error: str = ""
    samples: list[Vacancy] = field(default_factory=list)


@dataclass
class RunReport:
    sources: list[SourceReport] = field(default_factory=list)
    sent: int = 0
    overflow: int = 0
    send_error: str = ""

    def summary_lines(self) -> list[str]:
        lines = []
        for r in self.sources:
            if r.status == "skipped":
                continue
            if r.status in ("error", "not_configured"):
                lines.append(f"{r.name}: {r.status} — {r.error}")
            else:
                extra = " (первый запуск: запомнил текущие, не отправлял)" if r.status == "bootstrap" else ""
                lines.append(f"{r.name}: получено {r.fetched}, подходит {r.matched}, новых {r.new}{extra}")
        lines.append(f"Отправлено: {self.sent}" + (f", сверх лимита: {self.overflow}" if self.overflow else ""))
        if self.send_error:
            lines.append(f"Ошибка отправки: {self.send_error}")
        return lines


def run_once(cfg: dict, sources: list[Source], state: State, notifier: Notifier, *,
             force: bool = False, only: set[str] | None = None, preview: int = 0) -> RunReport:
    agent_cfg = cfg.get("agent") or {}
    filters = Filters.from_config(cfg.get("filters"))
    max_per_run = int(agent_cfg.get("max_per_run", 25))
    first_run = agent_cfg.get("first_run", "silent")  # silent | send
    alert_after = int(agent_cfg.get("alert_after_failures", 6))
    snippet_len = int(agent_cfg.get("snippet_length", 350))
    report = RunReport()
    candidates: list[Vacancy] = []

    for src in sources:
        rep = SourceReport(src.name)
        report.sources.append(rep)
        if only and src.name not in only and src.kind not in only:
            rep.status = "skipped"
            continue
        if not force and not state.due(src.name, src.interval):
            rep.status = "skipped"
            continue
        try:
            src.check_ready()
            items = src.fetch()
        except SourceConfigError as exc:
            rep.status, rep.error = "not_configured", str(exc)
            log.warning("%s: не настроен — %s", src.name, exc)
            continue
        except Exception as exc:  # сайт упал/поменял формат — остальные продолжают работать
            rep.status, rep.error = "error", f"{type(exc).__name__}: {exc}"[:300]
            failures = state.record_failure(src.name, rep.error)
            log.warning("%s: ошибка (%d подряд) — %s", src.name, failures, rep.error)
            info = state.source(src.name)
            if failures >= alert_after and not info.get("alerted"):
                _safe_send(notifier, f"⚠️ Источник <b>{esc(src.name)}</b> не отвечает уже {failures} раз подряд.\n"
                                     f"<code>{esc(rep.error[:200])}</code>", report)
                info["alerted"] = True
            continue

        rep.fetched = len(items)
        matched = [v for v in items if v.url and filters.matches(v)]
        rep.matched = len(matched)
        rep.samples = matched[:preview]
        fresh = [v for v in matched if not state.is_seen(v.key, _fp(v))]
        rep.new = len(fresh)

        if not state.is_source_initialized(src.name) and first_run == "silent":
            rep.status = "bootstrap"
            for v in matched:
                state.mark_seen(v.key, _fp(v))
        else:
            candidates.extend(fresh)
        state.record_success(src.name, rep.fetched)
        log.info("%s: получено %d, подходит %d, новых %d", src.name, rep.fetched, rep.matched, rep.new)

    # одна и та же вакансия с разных сайтов — отправляем один раз
    unique: list[Vacancy] = []
    seen_fp: set[str] = set()
    for v in candidates:
        fp = _fp(v)
        if fp and fp in seen_fp:
            state.mark_seen(v.key, fp)
            continue
        if fp:
            seen_fp.add(fp)
        unique.append(v)
    unique.sort(key=lambda v: v.published.timestamp() if v.published else 0, reverse=True)

    to_send, overflow = unique[:max_per_run], unique[max_per_run:]
    for v in to_send:
        try:
            notifier.send_vacancy(v, snippet_len)
        except TelegramError as exc:
            report.send_error = str(exc)
            log.error("Не удалось отправить: %s — остальное попробую в следующий раз", exc)
            break
        state.mark_seen(v.key, _fp(v))
        report.sent += 1

    if overflow and not report.send_error:
        for v in overflow:
            state.mark_seen(v.key, _fp(v))
        report.overflow = len(overflow)
        _safe_send(notifier, f"…и ещё <b>{len(overflow)}</b> новых вакансий не влезли в лимит "
                             f"({max_per_run} за раз). Сузь критерии в config.yaml или подними "
                             f"agent.max_per_run.", report)

    if not state.started_notice_sent and not report.send_error:
        working = [r for r in report.sources if r.status in ("ok", "bootstrap")]
        if working:
            names = ", ".join(r.name for r in working)
            if _safe_send(notifier, "🤖 Агент поиска работы запущен.\n"
                                    f"Слежу за: {esc(names)}.\n"
                                    "Буду присылать новые вакансии сюда.", report):
                state.started_notice_sent = True

    state.prune(int(agent_cfg.get("remember_days", 60)))
    return report


def _fp(v: Vacancy) -> str | None:
    # без компании отпечаток слишком общий ("Python developer|") — не склеиваем
    return v.fingerprint if v.company.strip() else None


def _safe_send(notifier: Notifier, text: str, report: RunReport) -> bool:
    try:
        notifier.send_text(text)
        return True
    except TelegramError as exc:
        report.send_error = report.send_error or str(exc)
        log.error("Не удалось отправить служебное сообщение: %s", exc)
        return False


def sleep_until_next(interval_minutes: float, started: float) -> None:
    wait = interval_minutes * 60 - (time.time() - started)
    if wait > 0:
        log.info("Сплю %.0f мин до следующего круга", wait / 60)
        time.sleep(wait)
