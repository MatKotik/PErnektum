"""Международные доски удалённой работы с открытыми JSON API."""

from __future__ import annotations

from ..util import format_salary, html_to_text, join_nonempty, parse_date
from .base import Source, register


@register
class RemoteOK(Source):
    kind = "remoteok"
    title = "Remote OK"
    default_interval = 30

    def fetch(self):
        data = self.http.get_json("https://remoteok.com/api")
        out = []
        for job in data:
            if not isinstance(job, dict) or "id" not in job or not job.get("position"):
                continue  # первый элемент — юридическое уведомление
            out.append(self.vacancy(
                id=job["id"],
                title=html_to_text(job.get("position")),
                company=html_to_text(job.get("company")),
                url=job.get("url") or f"https://remoteok.com/remote-jobs/{job['id']}",
                location=job.get("location") or "Remote",
                salary=format_salary(job.get("salary_min"), job.get("salary_max"), "USD"),
                description=html_to_text(job.get("description")),
                tags=[t for t in job.get("tags") or [] if isinstance(t, str)],
                published=parse_date(job.get("epoch") or job.get("date")),
                remote=True,
            ))
        return out


@register
class Remotive(Source):
    kind = "remotive"
    title = "Remotive"
    default_interval = 360  # API просит не дёргать чаще нескольких раз в день

    def fetch(self):
        params = {"limit": self.limit}
        if self.query:
            params["search"] = self.query
        data = self.http.get_json("https://remotive.com/api/remote-jobs", params=params)
        out = []
        for job in data.get("jobs", []):
            out.append(self.vacancy(
                id=job["id"],
                title=job.get("title", ""),
                company=job.get("company_name", ""),
                url=job.get("url", ""),
                location=job.get("candidate_required_location") or "Remote",
                salary=job.get("salary") or "",
                description=html_to_text(job.get("description")),
                tags=list(job.get("tags") or []) + [t for t in (job.get("category"),
                     (job.get("job_type") or "").replace("_", " ")) if t],
                published=parse_date(job.get("publication_date")),
                remote=True,
            ))
        return out


@register
class Arbeitnow(Source):
    kind = "arbeitnow"
    title = "Arbeitnow"
    default_interval = 60

    def fetch(self):
        data = self.http.get_json("https://www.arbeitnow.com/api/job-board-api")
        out = []
        for job in data.get("data", []):
            out.append(self.vacancy(
                id=job.get("slug") or job.get("url"),
                title=job.get("title", ""),
                company=job.get("company_name", ""),
                url=job.get("url", ""),
                location=join_nonempty(job.get("location"), "Remote" if job.get("remote") else ""),
                description=html_to_text(job.get("description")),
                tags=list(job.get("tags") or []) + list(job.get("job_types") or []),
                published=parse_date(job.get("created_at")),
                remote=bool(job.get("remote")),
            ))
        return out


@register
class Himalayas(Source):
    kind = "himalayas"
    title = "Himalayas"
    default_interval = 60

    def fetch(self):
        if self.query:
            url = "https://himalayas.app/jobs/api/search"
            params = {"q": self.query, "sort": "recent"}
        else:
            url = "https://himalayas.app/jobs/api"
            params = {"limit": min(self.limit, 20)}
        data = self.http.get_json(url, params=params)
        out = []
        for job in data.get("jobs", []):
            link = job.get("applicationLink") or job.get("guid") or ""
            out.append(self.vacancy(
                id=job.get("guid") or link,
                title=job.get("title", ""),
                company=job.get("companyName", ""),
                url=link,
                location=", ".join(job.get("locationRestrictions") or []) or "Remote",
                salary=format_salary(job.get("minSalary"), job.get("maxSalary"), job.get("currency")),
                description=html_to_text(job.get("excerpt") or job.get("description")),
                tags=list(job.get("categories") or []) + list(job.get("seniority") or [])
                     + ([job["employmentType"]] if job.get("employmentType") else []),
                published=parse_date(job.get("pubDate")),
                remote=True,
            ))
        return out


@register
class Jobicy(Source):
    kind = "jobicy"
    title = "Jobicy"
    default_interval = 60  # просят не чаще раза в час

    def fetch(self):
        params = {"count": min(self.limit, 100)}
        if self.query:
            params["tag"] = self.query
        data = self.http.get_json("https://jobicy.com/api/v2/remote-jobs", params=params)
        out = []
        for job in data.get("jobs", []):
            out.append(self.vacancy(
                id=job["id"],
                title=html_to_text(job.get("jobTitle")),
                company=html_to_text(job.get("companyName")),
                url=job.get("url", ""),
                location=job.get("jobGeo") or "Remote",
                salary=format_salary(job.get("annualSalaryMin") or job.get("salaryMin"),
                                     job.get("annualSalaryMax") or job.get("salaryMax"),
                                     job.get("salaryCurrency")),
                description=html_to_text(job.get("jobExcerpt") or job.get("jobDescription")),
                tags=_as_list(job.get("jobIndustry")) + _as_list(job.get("jobType")) + _as_list(job.get("jobLevel")),
                published=parse_date(job.get("pubDate")),
                remote=True,
            ))
        return out


def _as_list(value) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [html_to_text(str(v)) for v in value]
    return [html_to_text(str(value))]
