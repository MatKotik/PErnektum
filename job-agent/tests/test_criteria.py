"""Фильтры: группы слов, регэкспы, удалёнка, и реальные критерии из config.yaml."""

from datetime import datetime, timezone

import pytest
import yaml

from jobagent.filters import Filters
from jobagent.models import Vacancy
from jobagent.notify import format_vacancy

NOW = datetime.now(timezone.utc)


def vac(title, description="", remote=None, company="", tags=None):
    return Vacancy(source="t", id=title, title=title, url="https://x", company=company,
                   description=description, remote=remote, tags=tags or [], published=NOW)


def test_groups_regex_remote_and_title_exclusions():
    f = Filters(keyword_groups=[["python"], ["re:гибк\\w* график", "part-time"]],
                exclude_title_keywords=["senior"], remote_only=True)
    assert f.matches(vac("Python dev", "гибкий график", remote=True))
    assert not f.matches(vac("Python dev", "офис 5/2", remote=True))       # вторая группа не нашлась
    assert not f.matches(vac("Senior Python", "part-time", remote=True))   # стоп-слово в названии
    assert f.matches(vac("Python", "part-time, work with senior devs", remote=True))
    assert not f.matches(vac("Python", "part-time", remote=False))
    # сайт формат не знает → ищем признаки удалёнки в тексте
    assert f.matches(vac("Python", "part-time, удалённо"))
    assert not f.matches(vac("Python", "part-time, офис в Москве"))
    assert f.hint(vac("Python", "part-time и гибкий график")) == "python · гибкий график · part-time"


@pytest.fixture(scope="module")
def real():
    cfg = yaml.safe_load(open("config.yaml", encoding="utf-8"))
    return Filters.from_config(cfg["filters"])


@pytest.mark.parametrize("title,desc", [
    ("Оператор чата", "Удаленная работа, гибкий график, без опыта, обучение"),
    ("Репетитор по математике", "Онлайн-школа, работаем удалённо, удобное время, по вечерам"),
    ("Копирайтер", "Удалёнка, частичная занятость, 15 часов в неделю"),
    ("Стажёр-аналитик", "Стажировка для студентов, можно удалённо"),
    ("Content moderator", "Remote, part-time, flexible hours"),
    ("SEO Specialist", "Удаленка, проектная работа, закупка дроп-доменов"),
    ("Менеджер", "Удаленно, гибкий график. Присылайте резюме вложением"),
])
def test_student_friendly_vacancies_pass(real, title, desc):
    assert real.rejection_reason(vac(title, desc)) is None


@pytest.mark.parametrize("title,desc", [
    ("Партнёр", "Удалённо, гибкий график. Приём платежей на свою карту, 5% с оборота"),
    ("Помощник", "Ищем дропов, удаленно, подработка"),
    ("Удалёнка с доходом от 70.000 для новичков", "гибкий график, удаленно"),
    ("Оператор", "Удаленно, без опыта, без вложений!"),
    ("Модель", "Работа из дома, гибкий график, вебкам"),
    ("Подработка", "Удаленно, свободный график, лайкать посты"),
    ("Курьер", "гибкий график, удалённо. Реклама. erid: 2VtzqwXYZ"),
    ("Senior Python Developer", "Удаленно, гибкий график"),
    ("Резюме: SMM-специалист", "Ищу подработку удаленно"),
    ("Бухгалтер", "Удаленно, полный рабочий день 9-18, 5/2"),      # график не подходит
    ("Кассир", "Гибкий график, подработка для студентов, офис на Ленина"),  # не удалёнка
])
def test_scams_and_unfit_are_rejected(real, title, desc):
    assert real.rejection_reason(vac(title, desc)) is not None


def test_hint_is_shown_in_message(real):
    v = vac("Оператор чата", "Удаленная работа, гибкий график, без опыта")
    v.match_hint = real.hint(v)
    assert "✅ гибкий график · без опыта" in format_vacancy(v)


def test_negated_part_time_is_rejected(real):
    v = vac("Интервьюер (удаленно)", "Удаленно. Вакансия не подразумевает подработку. Без опыта.")
    assert real.rejection_reason(v) is not None


def test_only_locations_per_source(tmp_path):
    from jobagent.agent import run_once
    from jobagent.notify import ConsoleNotifier
    from jobagent.sources.base import Source
    from jobagent.storage import State

    class Board(Source):
        kind = "board"

        def fetch(self):
            return [Vacancy(source="board", id=loc, title=f"Job {loc}", url=f"https://x/{loc}",
                            location=loc, remote=True, published=NOW)
                    for loc in ["Anywhere in the World", "USA Only", "Worldwide", "Germany", "Remote", ""]]

    src = Board(None, {"only_locations": ["anywhere", "worldwide", "re:^remote$"]})
    out = ConsoleNotifier()
    rep = run_once({"agent": {"first_run": "send"}}, [src], State(tmp_path / "s.json"), out, force=True)
    sent = {line for m in out.sent for line in m.splitlines() if line.startswith("<b>")}
    assert sent == {"<b>Job Anywhere in the World</b>", "<b>Job Worldwide</b>", "<b>Job Remote</b>", "<b>Job </b>"}
    assert rep.sources[0].fetched == 6


HABR_INTERNS = """<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<item><title>Требуется «Разработчик .NET (Стажер)» (Москва)</title>
<description>Компания «Лоция» ищет хорошего специалиста на вакансию «Разработчик .NET (Стажер)». Москва (Россия). Неполный рабочий день. Можно удалённо. Требуемые навыки: #intern, #C#.</description>
<author>Лоция</author><pubDate>{d}</pubDate><link>https://career.habr.com/vacancies/1</link><guid>1</guid></item>
<item><title>Требуется «Стажировка Python разработчик (FastAPI)» (от 40 000 до 60 000 ₽)</title>
<description>Компания «Pulsea» ищет... От 40 000 ₽ до 60 000 ₽. Полный рабочий день. Можно удалённо. Требуемые навыки: #intern, #Python, #FastAPI.</description>
<author>Pulsea</author><pubDate>{d}</pubDate><link>https://career.habr.com/vacancies/2</link><guid>2</guid></item>
<item><title>Требуется «Начинающий специалист по работе с документами» (Санкт-Петербург)</title>
<description>Компания «ИТ Контакт» ищет... Санкт-Петербург (Россия). Полный рабочий день. Требуемые навыки: #intern.</description>
<author>ИТ Контакт</author><pubDate>{d}</pubDate><link>https://career.habr.com/vacancies/3</link><guid>3</guid></item>
<item><title>Требуется «ML разработчик / Проектная работа»</title>
<description>Компания «Extyl» ищет... Полный рабочий день. Можно удалённо. Требуемые навыки: #senior, #Python.</description>
<author>Extyl</author><pubDate>{d}</pubDate><link>https://career.habr.com/vacancies/4</link><guid>4</guid></item>
</channel></rss>"""


def test_habr_interns_feed_with_real_criteria(real):
    from email.utils import format_datetime
    from jobagent.config import build_sources
    from tests.test_sources import FakeHttp

    xml = HABR_INTERNS.replace("{d}", format_datetime(NOW))
    cfg = {"sources": {"habr_career:interns": {"remote": True, "qid": 1}}}
    [src] = build_sources(cfg, FakeHttp({"https://career.habr.com": xml}))
    assert src.name == "habr_career:interns" and src.feed_url().endswith("&remote=true&qid=1")
    passed = [v.title for v in src.fetch() if real.matches(v)]
    assert passed == ["Разработчик .NET (Стажер)", "Стажировка Python разработчик (FastAPI)"]


@pytest.mark.parametrize("desc,ok", [
    ("Удалённо, гибкий график. Английский B1 — плюс", True),
    ("Удалённо, гибкий график. Английский язык на уровне B2 и выше", False),
    ("Remote, part-time. English: Upper-Intermediate", False),
    ("Удалённо, частичная занятость. Свободное владение английским", False),
])
def test_english_level(real, desc, ok):
    assert (real.rejection_reason(vac("Стажёр-разработчик", desc)) is None) is ok


def test_intern_word_counts_only_in_title(real):
    assert real.matches(vac("Backend Intern", "Remote"))
    assert not real.matches(vac("Backend Engineer", "Remote. We also run internships every summer."))
