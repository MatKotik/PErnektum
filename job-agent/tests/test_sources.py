"""Разбор ответов каждого сайта на образцах их формата."""

import os
import time

import pytest

from jobagent.sources import REGISTRY, SourceConfigError
from jobagent.sources.rss import RssSource, parse_feed
from jobagent.sources.telegram_channels import parse_channel_page


class FakeHttp:
    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def _find(self, url):
        for prefix, payload in self.routes.items():
            if url.startswith(prefix):
                return payload
        raise AssertionError(f"неожиданный URL {url}")

    def get_json(self, url, params=None, headers=None):
        self.calls.append((url, params, headers))
        return self._find(url)

    def get_text(self, url, params=None, headers=None):
        self.calls.append((url, params, headers))
        return self._find(url)


def make(kind, routes, options=None, query=""):
    http = FakeHttp(routes)
    return REGISTRY[kind](http, options or {}, query), http


def test_remoteok_skips_legal_notice():
    src, _ = make("remoteok", {"https://remoteok.com/api": [
        {"last_updated": 1, "legal": "notice"},
        {"id": "123", "epoch": 1700000000, "company": "Acme", "position": "Python Dev",
         "tags": ["python", "django"], "description": "<p>Hello &amp; welcome</p>",
         "location": "Worldwide", "salary_min": 80000, "salary_max": 120000,
         "url": "https://remoteok.com/remote-jobs/123"},
    ]})
    [v] = src.fetch()
    assert (v.id, v.title, v.company, v.remote) == ("123", "Python Dev", "Acme", True)
    assert v.salary == "80 000–120 000 $"
    assert v.description == "Hello & welcome"
    assert v.published.year == 2023


def test_remotive_passes_query():
    src, http = make("remotive", {"https://remotive.com/api/remote-jobs": {"jobs": [
        {"id": 7, "url": "https://remotive.com/x", "title": "QA", "company_name": "B",
         "category": "QA", "tags": ["selenium"], "publication_date": "2026-11-20T10:00:00",
         "candidate_required_location": "Europe", "salary": "$50k", "description": "<b>x</b>"}]}},
        query="qa")
    [v] = src.fetch()
    assert http.calls[0][1]["search"] == "qa"
    assert v.location == "Europe" and v.salary == "$50k" and "QA" in v.tags


def test_arbeitnow_himalayas_jobicy():
    src, _ = make("arbeitnow", {"https://www.arbeitnow.com": {"data": [
        {"slug": "s1", "company_name": "C", "title": "Dev", "description": "d", "remote": True,
         "url": "https://arbeitnow.com/s1", "tags": [], "job_types": ["full time"],
         "location": "Berlin", "created_at": 1763600000}]}})
    [v] = src.fetch()
    assert v.location == "Berlin, Remote" and v.remote

    src, _ = make("himalayas", {"https://himalayas.app/jobs/api": {"jobs": [
        {"title": "Designer", "excerpt": "e", "companyName": "H", "minSalary": 1000,
         "maxSalary": None, "currency": "EUR", "locationRestrictions": ["Spain"],
         "categories": ["Design"], "pubDate": 1763600000, "applicationLink": "https://h/1",
         "guid": "https://himalayas.app/j/1"}]}})
    [v] = src.fetch()
    assert v.salary == "от 1 000 €" and v.location == "Spain"

    src, _ = make("jobicy", {"https://jobicy.com/api/v2/remote-jobs": {"jobs": [
        {"id": 5, "url": "https://jobicy.com/5", "jobTitle": "SEO &amp; Content",
         "companyName": "J", "jobIndustry": ["Marketing"], "jobType": ["full-time"],
         "jobGeo": "USA", "jobLevel": "Any", "jobExcerpt": "x", "pubDate": "2026-11-26 10:00:00"}]}})
    [v] = src.fetch()
    assert v.title == "SEO & Content" and v.tags == ["Marketing", "full-time", "Any"]


def test_trudvsem():
    src, http = make("trudvsem", {"https://opendata.trudvsem.ru/api/v1/vacancies": {
        "status": "200", "meta": {"total": 1}, "results": {"vacancies": [{"vacancy": {
            "id": "abc-1", "job-name": "Программист", "salary_min": 60000, "salary_max": 0,
            "company": {"name": "ООО Ромашка"}, "vac_url": "https://trudvsem.ru/vacancy/card/1/abc-1",
            "creation-date": "2026-11-25", "region": {"name": "г. Москва"},
            "schedule": "Удаленная работа", "employment": "Полная занятость",
            "duty": "<p>Писать код</p>", "category": {"specialisation": "IT"},
            "addresses": {"address": [{"location": "г. Москва, ул. Ленина, 1"}]}}}]}}},
        options={"region": None}, query="python")
    [v] = src.fetch()
    assert v.title == "Программист" and v.company == "ООО Ромашка"
    assert v.salary == "от 60 000 ₽" and v.remote is True
    assert v.location.startswith("г. Москва, ул.")
    assert http.calls[0][1]["text"] == "python" and "modifiedFrom" in http.calls[0][1]


def test_superjob_and_hh_need_keys(monkeypatch):
    monkeypatch.delenv("SUPERJOB_API_KEY", raising=False)
    monkeypatch.delenv("HH_ACCESS_TOKEN", raising=False)
    for kind in ("superjob", "hh"):
        src, _ = make(kind, {})
        with pytest.raises(SourceConfigError):
            src.check_ready()


def test_superjob(monkeypatch):
    monkeypatch.setenv("SUPERJOB_API_KEY", "k")
    src, http = make("superjob", {"https://api.superjob.ru": {"objects": [
        {"id": 9, "profession": "Менеджер", "firm_name": "Фирма", "payment_from": 50000,
         "payment_to": 70000, "currency": "rub", "town": {"title": "Казань"},
         "link": "https://superjob.ru/9", "date_published": 1763600000,
         "place_of_work": {"id": 2, "title": "Удалённая работа"}}]}})
    [v] = src.fetch()
    assert http.calls[0][2]["X-Api-App-Id"] == "k"
    assert v.salary == "50 000–70 000 ₽" and v.remote and "Казань" in v.location


def test_hh(monkeypatch):
    monkeypatch.setenv("HH_ACCESS_TOKEN", "tok")
    src, http = make("hh", {"https://api.hh.ru/vacancies": {"items": [
        {"id": "100", "name": "Аналитик", "employer": {"name": "Банк"},
         "salary": {"from": 100000, "to": None, "currency": "RUR"}, "area": {"name": "Москва"},
         "alternate_url": "https://hh.ru/vacancy/100", "published_at": "2026-11-26T12:00:00+0300",
         "snippet": {"requirement": "<highlighttext>SQL</highlighttext>", "responsibility": "Отчёты"},
         "schedule": {"name": "Удаленная работа"}}]}})
    [v] = src.fetch()
    assert http.calls[0][2]["Authorization"] == "Bearer tok"
    assert v.salary == "от 100 000 ₽" and v.published.hour == 9 and v.remote
    assert "SQL" in v.description


RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>t</title>
<item><title>Acme Inc: Senior Go Engineer</title><link>https://weworkremotely.com/1</link>
<guid>https://weworkremotely.com/1</guid><pubDate>Wed, 26 Nov 2026 10:00:00 +0000</pubDate>
<region>Anywhere in the World</region><category>Programming</category>
<description>&lt;p&gt;Great job&lt;/p&gt;</description></item>
<item><title>Python Developer в SoftServe, Київ, віддалено</title><link>https://jobs.dou.ua/2</link>
<pubDate>Wed, 26 Nov 2026 11:00:00 +0200</pubDate><description>d</description></item>
</channel></rss>"""

ATOM = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>x</title>
<entry><title>Java dev</title><link rel="alternate" href="https://ex.com/j/1"/>
<id>tag:ex.com,1</id><updated>2026-11-26T10:00:00Z</updated><summary>s</summary>
<author><name>Corp</name></author></entry></feed>"""


def test_rss_and_atom():
    items = parse_feed(RSS)
    assert len(items) == 2 and items[0]["extra"]["region"] == "Anywhere in the World"
    [a] = parse_feed(ATOM)
    assert a["link"] == "https://ex.com/j/1" and a["guid"] == "tag:ex.com,1"
    assert a["author"] == "Corp"


def test_wwr_and_dou_titles():
    src, _ = make("weworkremotely", {"https://weworkremotely.com": RSS})
    v = src.fetch()[0]
    assert (v.company, v.title, v.location) == ("Acme Inc", "Senior Go Engineer", "Anywhere in the World")
    src, http = make("dou", {"https://jobs.dou.ua": RSS}, query="python dev")
    v = src.fetch()[1]
    assert (v.title, v.company, v.location) == ("Python Developer", "SoftServe", "Київ, віддалено")
    assert http.calls[0][0].endswith("search=python+dev")


def test_generic_rss_feed_url():
    src = RssSource(FakeHttp({"https://ex.com": ATOM}),
                    {"url": "https://ex.com/feed?q={query}", "title": "Пример"}, "c++", name="rss:ex")
    [v] = src.fetch()
    assert src.feed_url() == "https://ex.com/feed?q=c%2B%2B"
    assert v.source == "rss:ex" and v.source_title == "Пример" and v.company == "Corp"


TG_PAGE = """
<div class="tgme_widget_message_wrap js-widget_message_wrap">
 <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="geekjobs/101">
  <div class="tgme_widget_message_bubble">
   <div class="tgme_widget_message_reply"><div class="tgme_widget_message_text js-message_reply_text">старое</div></div>
   <div class="tgme_widget_message_text js-message_text" dir="auto">#вакансия #python<br/><b>Python-разработчик</b> в Яндекс<br/>Зарплата: 300к<div class="inner">вложенный</div> конец</div>
   <div class="tgme_widget_message_footer"><a class="tgme_widget_message_date" href="https://t.me/geekjobs/101"><time datetime="2026-11-26T09:30:00+00:00" class="time">09:30</time></a></div>
  </div>
 </div>
</div>
<div class="tgme_widget_message_wrap js-widget_message_wrap">
 <div class="tgme_widget_message js-widget_message" data-post="geekjobs/102">
  <div class="tgme_widget_message_photo_wrap"></div>
  <div class="tgme_widget_message_footer"><time datetime="2026-11-26T10:00:00+00:00"></time></div>
 </div>
</div>"""


def test_telegram_channel_parser_and_source():
    posts = parse_channel_page(TG_PAGE)
    assert len(posts) == 1  # пост без текста (только фото) пропускаем
    assert posts[0]["text"].startswith("#вакансия #python\nPython-разработчик в Яндекс")
    assert "вложенный" in posts[0]["text"] and "старое" not in posts[0]["text"]

    src, http = make("telegram", {"https://t.me/s/geekjobs": TG_PAGE},
                     options={"channels": ["@geekjobs"]})
    [v] = src.fetch()
    assert http.calls[0][0] == "https://t.me/s/geekjobs"
    assert v.title == "Python-разработчик в Яндекс"
    assert v.url == "https://t.me/geekjobs/101" and v.tags == ["#вакансия", "#python"]
    assert v.source_title == "Telegram @geekjobs"


def test_telegram_requires_channels():
    src, _ = make("telegram", {}, options={"channels": []})
    with pytest.raises(SourceConfigError):
        src.check_ready()


HABR_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
<item><title>Требуется «Инженер ЦОД» (Ногинск, от 90 000 до 130 000 ₽)</title>
<link>https://career.habr.com/vacancies/1</link><guid>https://career.habr.com/vacancies/1</guid>
<dc:creator>Ростелеком</dc:creator><pubDate>Thu, 27 Nov 2026 14:58:00 +0000</pubDate>
<description>Компания ищет... Полный рабочий день.</description></item>
<item><title>Требуется «Python-разработчик (Django)» (Можно удалённо)</title>
<link>https://career.habr.com/vacancies/2</link><dc:creator>Кто-то</dc:creator>
<description>Можно удалённо.</description></item>
</channel></rss>"""


def test_habr_career_title_split():
    src, _ = make("habr_career", {"https://career.habr.com": HABR_RSS})
    a, b = src.fetch()
    assert (a.title, a.company, a.location, a.salary) == (
        "Инженер ЦОД", "Ростелеком", "Ногинск", "от 90 000 до 130 000 ₽")
    assert a.remote is False
    assert (b.title, b.location, b.remote) == ("Python-разработчик (Django)", "Можно удалённо", True)


def test_preescaped_and_mojibake_text_is_cleaned():
    src, _ = make("remoteok", {"https://remoteok.com/api": [
        {"id": "1", "position": "Sales &amp; Ops", "company": "A&amp;B",
         "description": "Â About the team", "tags": ["R&amp;D"], "url": "https://x/1"}]})
    [v] = src.fetch()
    assert (v.title, v.company, v.tags) == ("Sales & Ops", "A&B", ["R&D"])
    assert v.description == "About the team"


def test_telegram_title_strips_leading_emoji():
    from jobagent.sources.telegram_channels import _title_from_text
    assert _title_from_text("🔹 Руководитель отдела\nещё") == "Руководитель отдела"
    assert _title_from_text("#job\n🔥🔥 «Senior» QA") == "«Senior» QA"
