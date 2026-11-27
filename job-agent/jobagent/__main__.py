"""Запуск: python -m jobagent [--dry-run] [--loop] [--test-telegram] ..."""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from pathlib import Path

from .agent import run_once, sleep_until_next
from .config import build_sources, load_config
from .http import HttpClient
from .notify import ConsoleNotifier, Notifier, TelegramError, TelegramNotifier, format_vacancy
from .storage import State

log = logging.getLogger("jobagent")
HERE = Path(__file__).resolve().parent.parent


def make_notifier(dry_run: bool) -> Notifier:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if dry_run:
        return ConsoleNotifier()
    if token and chat:
        return TelegramNotifier(token, chat)
    log.warning("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не заданы — печатаю вакансии в консоль")
    return ConsoleNotifier()


def github_summary(lines: list[str], has_errors: bool) -> None:
    """В GitHub Actions выводим итог запуска прямо на странице run'а."""
    if os.environ.get("GITHUB_ACTIONS") != "true":
        return
    body = "%0A".join(line.replace("%", "%25").replace("\n", " ") for line in lines)
    print(f"::{'warning' if has_errors else 'notice'} title=Job Agent::{body}")
    summary_file = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_file:
        with open(summary_file, "a", encoding="utf-8") as fh:
            fh.write("### Job Agent\n\n" + "\n".join(f"- {line}" for line in lines) + "\n")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="jobagent", description="Агент мониторинга вакансий")
    p.add_argument("--config", default=str(HERE / "config.yaml"))
    p.add_argument("--state", default=str(HERE / "state" / "state.json"))
    p.add_argument("--dry-run", action="store_true",
                   help="ничего не отправлять и не запоминать — только показать, что нашлось")
    p.add_argument("--force", action="store_true", help="опросить все сайты, не глядя на интервалы")
    p.add_argument("--only", default="", help="через запятую: какие источники опросить")
    p.add_argument("--preview", type=int, default=0, help="показать N примеров с каждого источника")
    p.add_argument("--loop", action="store_true", help="работать бесконечно (для своего ПК/сервера)")
    p.add_argument("--every", type=float, default=None, help="минут между кругами в режиме --loop")
    p.add_argument("--test-telegram", action="store_true", help="отправить тестовое сообщение и выйти")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")

    if args.test_telegram:
        notifier = make_notifier(False)
        if not isinstance(notifier, TelegramNotifier):
            log.error("Для теста нужны TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID")
            return 2
        try:
            notifier.send_text("✅ Связь с агентом поиска работы есть. Сюда будут приходить вакансии.")
        except TelegramError as exc:
            log.error("Telegram ответил ошибкой: %s", exc)
            return 1
        log.info("Тестовое сообщение отправлено")
        return 0

    cfg = load_config(args.config)
    http = HttpClient()
    only = {s.strip() for s in args.only.split(",") if s.strip()} or None
    interval = args.every or float((cfg.get("agent") or {}).get("interval_minutes", 20))

    while True:
        started = time.time()
        state = State(args.state).load()
        notifier = make_notifier(args.dry_run)
        sources = build_sources(cfg, http)
        report = run_once(cfg, sources, state, notifier, force=args.force or args.dry_run,
                          only=only, preview=args.preview)
        if not args.dry_run:
            state.save()
        for r in report.sources:
            for v in r.samples:
                print(f"\n[пример: {r.name}]\n{format_vacancy(v)}")
        lines = report.summary_lines()
        print("\n" + "\n".join(lines))
        has_errors = any(r.status == "error" for r in report.sources) or bool(report.send_error)
        github_summary(lines, has_errors)
        if not args.loop:
            return 1 if report.send_error else 0
        sleep_until_next(interval, started)


if __name__ == "__main__":
    sys.exit(main())
