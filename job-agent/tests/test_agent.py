"""Логика цикла: первый запуск, дубли, лимиты, фильтры, ошибки сайтов и Telegram."""

from datetime import datetime, timedelta, timezone

from jobagent.agent import run_once
from jobagent.config import build_sources, deep_merge, load_config
from jobagent.filters import Filters
from jobagent.models import Vacancy
from jobagent.notify import ConsoleNotifier, TelegramError, TelegramNotifier, format_vacancy
from jobagent.sources.base import Source
from jobagent.storage import State

NOW = datetime.now(timezone.utc)


def vac(i, title="Python developer", company="Acme", source="fake", **kw):
    return Vacancy(source=source, id=str(i), title=title, company=company,
                   url=f"https://ex.com/{i}", published=kw.pop("published", NOW), **kw)


class FakeSource(Source):
    kind = "fake"
    title = "Fake"

    def __init__(self, items, name="fake", fail=None):
        super().__init__(http=None, options={}, query="", name=name)
        self.items, self.fail = items, fail

    def fetch(self):
        if self.fail:
            raise self.fail
        return list(self.items)


def cfg(**agent):
    return {"agent": {"first_run": "silent", "max_per_run": 25, **agent}, "filters": {}}


def test_first_run_is_silent_then_only_new_are_sent(tmp_path):
    state = State(tmp_path / "s.json").load()
    out = ConsoleNotifier()
    src = FakeSource([vac(1), vac(2, "Go dev")])
    rep = run_once(cfg(), [src], state, out, force=True)
    assert rep.sources[0].status == "bootstrap" and rep.sent == 0
    assert len(out.sent) == 1 and "запущен" in out.sent[0]
    state.save()

    state = State(tmp_path / "s.json").load()
    src.items.append(vac(3, "Java dev"))
    out = ConsoleNotifier()
    rep = run_once(cfg(), [src], state, out, force=True)
    assert rep.sent == 1 and "Java dev" in out.sent[0]

    out = ConsoleNotifier()
    rep = run_once(cfg(), [src], state, out, force=True)
    assert rep.sent == 0 and out.sent == []


def test_first_run_send_mode(tmp_path):
    state = State(tmp_path / "s.json").load()
    out = ConsoleNotifier()
    rep = run_once(cfg(first_run="send"), [FakeSource([vac(1), vac(2, "Go")])], state, out, force=True)
    assert rep.sent == 2


def test_cross_source_duplicates_and_overflow(tmp_path):
    state = State(tmp_path / "s.json").load()
    state.started_notice_sent = True
    a = FakeSource([vac(1, "Same job", "Corp"), *[vac(10 + i, f"Job {i}") for i in range(5)]], name="a")
    b = FakeSource([vac(99, "Same  job!", "corp", source="b")], name="b")
    for s in (a, b):
        state.record_success(s.name, 0)
    out = ConsoleNotifier()
    rep = run_once(cfg(max_per_run=3), [a, b], state, out, force=True)
    assert rep.sent == 3 and rep.overflow == 3  # 7 штук, но 6 уникальных: дубль склеен
    assert "ещё <b>3</b>" in out.sent[-1]
    assert all(state.is_seen(f"fake:{k}") for k in [1, 10, 11, 12, 13, 14])
    assert state.is_seen("b:99")


def test_filters():
    f = Filters(keywords=["python", "go"], exclude_keywords=["senior"], max_age_days=7)
    assert f.matches(vac(1, "Python developer"))
    assert f.matches(vac(2, "Backend", tags=["Go"]))
    assert not f.matches(vac(3, "Backend at Google"))          # "go" целым словом
    assert not f.matches(vac(4, "Senior Python developer"))
    assert not f.matches(vac(5, "Python", published=NOW - timedelta(days=10)))
    assert Filters(keywords=["разработчик"]).matches(vac(6, "Ищем разработчика"))
    assert Filters(remote_only=True).rejection_reason(vac(7, remote=False)) == "не удалёнка"
    assert Filters().matches(vac(8))  # без критериев подходит всё


def test_source_failure_is_isolated_and_alerts_once(tmp_path):
    state = State(tmp_path / "s.json").load()
    state.started_notice_sent = True
    bad = FakeSource([], name="bad", fail=ConnectionError("boom"))
    good = FakeSource([vac(1)], name="good")
    state.record_success("good", 0)
    alerts = []
    for _ in range(4):
        out = ConsoleNotifier()
        rep = run_once(cfg(alert_after_failures=3), [bad, good], state, out, force=True)
        alerts += [m for m in out.sent if "не отвечает" in m]
    assert rep.sources[0].status == "error" and "boom" in rep.sources[0].error
    assert len(alerts) == 1
    assert state.is_seen("fake:1")


class BrokenTelegram(ConsoleNotifier):
    def __init__(self, ok_count):
        super().__init__()
        self.ok_count = ok_count

    def send_text(self, text):
        if len(self.sent) >= self.ok_count:
            raise TelegramError("429: Too Many Requests")
        super().send_text(text)


def test_unsent_vacancies_are_retried_next_run(tmp_path):
    state = State(tmp_path / "s.json").load()
    state.started_notice_sent = True
    src = FakeSource([vac(i, f"Job {i}") for i in range(3)])
    state.record_success("fake", 0)
    rep = run_once(cfg(), [src], state, BrokenTelegram(ok_count=1), force=True)
    assert rep.sent == 1 and rep.send_error
    rep = run_once(cfg(), [src], state, ConsoleNotifier(), force=True)
    assert rep.sent == 2


def test_intervals_respected(tmp_path):
    state = State(tmp_path / "s.json").load()
    src = FakeSource([vac(1)])
    src.interval = 60
    run_once(cfg(), [src], state, ConsoleNotifier())
    rep = run_once(cfg(), [src], state, ConsoleNotifier())
    assert rep.sources[0].status == "skipped"


def test_format_escapes_html():
    text = format_vacancy(vac(1, "C++ <dev> & co", salary="100 $", location="Remote",
                              description="a" * 1000))
    assert "C++ &lt;dev&gt; &amp; co" in text and '<a href="https://ex.com/1">' in text
    assert len(text) < 700


def test_telegram_token_hidden_in_errors(monkeypatch):
    n = TelegramNotifier("123:SECRET", "1", delay=0)

    def boom(*a, **k):
        import requests
        raise requests.ConnectionError("failed url=/bot123:SECRET/sendMessage")

    monkeypatch.setattr(n.session, "post", boom)
    monkeypatch.setattr("time.sleep", lambda s: None)
    try:
        n.send_text("hi")
    except TelegramError as exc:
        assert "SECRET" not in str(exc) and "***" in str(exc)
    else:
        raise AssertionError("ожидалась ошибка")


def test_real_config_builds(monkeypatch):
    monkeypatch.setenv("JOB_AGENT_OVERRIDES", "filters:\n  keywords: [python]\nsources:\n  dou:\n    enabled: true\n")
    c = load_config("config.yaml")
    assert c["filters"]["keywords"] == ["python"] and c["filters"]["max_age_days"] == 7
    names = [s.name for s in build_sources(c, http=None)]
    assert "dou" in names and "habr_career" in names and "hh" not in names
    remotive = next(s for s in build_sources(c, None) if s.name == "remotive")
    assert remotive.interval == 360  # общий интервал не ускоряет «вежливые» источники
    assert deep_merge({"a": {"b": 1, "c": 2}}, {"a": {"b": 3}}) == {"a": {"b": 3, "c": 2}}


def test_github_run_waits_for_telegram_secrets(monkeypatch, tmp_path, capsys):
    from jobagent.__main__ import main
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    state = tmp_path / "state.json"
    assert main(["--state", str(state)]) == 0
    assert "::warning" in capsys.readouterr().out
    assert not state.exists()  # ничего не опрашивал и не запоминал
