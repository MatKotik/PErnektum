"""Российские сайты: «Работа России» (trudvsem), SuperJob, hh.ru."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ..util import format_salary, html_to_text, join_nonempty, parse_date
from .base import Source, register


@register
class Trudvsem(Source):
    """«Работа России» — государственная база вакансий, открытый API без ключа."""

    kind = "trudvsem"
    title = "Работа России"
    default_interval = 30

    def fetch(self):
        region = self.options.get("region")  # код региона, напр. 7700000000000 — Москва
        base = "https://opendata.trudvsem.ru/api/v1/vacancies"
        url = f"{base}/region/{region}" if region else base
        since = datetime.now(timezone.utc) - timedelta(days=float(self.options.get("days", 2)))
        params = {
            "offset": 0,
            "limit": min(self.limit, 100),
            "modifiedFrom": since.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        if self.query:
            params["text"] = self.query
        data = self.http.get_json(url, params=params)
        rows = ((data.get("results") or {}).get("vacancies")) or []
        out = []
        for row in rows:
            job = row.get("vacancy") or row
            schedule = join_nonempty(job.get("schedule"), job.get("employment"))
            addresses = ((job.get("addresses") or {}).get("address")) or []
            location = (job.get("region") or {}).get("name") or ""
            if addresses and isinstance(addresses, list) and addresses[0].get("location"):
                location = addresses[0]["location"]
            duty = html_to_text(job.get("duty"))
            req = job.get("requirement") or {}
            out.append(self.vacancy(
                id=job.get("id"),
                title=html_to_text(job.get("job-name")),
                company=html_to_text((job.get("company") or {}).get("name")),
                url=job.get("vac_url") or "",
                location=location,
                salary=format_salary(job.get("salary_min"), job.get("salary_max"), "RUB")
                       or (job.get("salary") or ""),
                description=join_nonempty(duty, html_to_text(req.get("qualification")), sep="\n"),
                tags=[t for t in [((job.get("category") or {}).get("specialisation")), schedule] if t],
                published=parse_date(job.get("creation-date")),
                remote="удален" in schedule.lower().replace("ё", "е"),
            ))
        return out


@register
class SuperJob(Source):
    """SuperJob. Нужен бесплатный ключ приложения: https://api.superjob.ru/register"""

    kind = "superjob"
    title = "SuperJob"
    default_interval = 30
    env_required = ("SUPERJOB_API_KEY",)

    def fetch(self):
        params = {
            "order_field": "date",
            "order_direction": "desc",
            "count": min(self.limit, 100),
            "period": self.options.get("period", 3),
        }
        if self.query:
            params["keyword"] = self.query
        if self.options.get("town"):
            params["town"] = self.options["town"]
        if self.options.get("remote"):
            params["place_of_work"] = 2
        data = self.http.get_json("https://api.superjob.ru/2.0/vacancies/", params=params,
                                  headers={"X-Api-App-Id": self.env("SUPERJOB_API_KEY")})
        out = []
        for job in data.get("objects", []):
            place = (job.get("place_of_work") or {}).get("title") or ""
            out.append(self.vacancy(
                id=job["id"],
                title=job.get("profession", ""),
                company=job.get("firm_name", ""),
                url=job.get("link", ""),
                location=join_nonempty((job.get("town") or {}).get("title"), place),
                salary=format_salary(job.get("payment_from"), job.get("payment_to"), job.get("currency")),
                description=join_nonempty(job.get("work"), job.get("candidat"), sep="\n"),
                published=parse_date(job.get("date_published")),
                remote=(job.get("place_of_work") or {}).get("id") == 2,
            ))
        return out


@register
class HeadHunter(Source):
    """hh.ru. С апреля 2026 API вакансий без авторизации отвечает 403,
    поэтому нужен токен приложения (HH_ACCESS_TOKEN) с https://dev.hh.ru"""

    kind = "hh"
    title = "hh.ru"
    default_interval = 20
    env_required = ("HH_ACCESS_TOKEN",)

    def fetch(self):
        params = {
            "order_by": "publication_time",
            "per_page": min(self.limit, 100),
            "period": self.options.get("period", 3),
        }
        if self.query:
            params["text"] = self.query
        if self.options.get("area"):
            params["area"] = self.options["area"]  # 113 — вся Россия, 1 — Москва, 2 — СПб
        if self.options.get("remote"):
            params["work_format"] = "REMOTE"
        headers = {
            "Authorization": f"Bearer {self.env('HH_ACCESS_TOKEN')}",
            "HH-User-Agent": self.options.get("user_agent", "JobAgent/1.0"),
        }
        data = self.http.get_json("https://api.hh.ru/vacancies", params=params, headers=headers)
        out = []
        for job in data.get("items", []):
            salary = job.get("salary") or job.get("salary_range") or {}
            snippet = job.get("snippet") or {}
            formats = [f.get("name", "") for f in job.get("work_format") or [] if isinstance(f, dict)]
            schedule = (job.get("schedule") or {}).get("name") or ""
            out.append(self.vacancy(
                id=job["id"],
                title=job.get("name", ""),
                company=(job.get("employer") or {}).get("name", ""),
                url=job.get("alternate_url") or f"https://hh.ru/vacancy/{job['id']}",
                location=(job.get("area") or {}).get("name", ""),
                salary=format_salary(salary.get("from"), salary.get("to"), salary.get("currency")),
                description=join_nonempty(html_to_text(snippet.get("responsibility")),
                                          html_to_text(snippet.get("requirement")), sep="\n"),
                tags=[t for t in [schedule, *formats] if t],
                published=parse_date(job.get("published_at")),
                remote=any("удал" in t.lower() for t in [schedule, *formats]) or None,
            ))
        return out
