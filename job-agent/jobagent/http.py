"""HTTP-клиент с таймаутами и повторами. Один на весь запуск."""

from __future__ import annotations

import logging
import time

import requests

log = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (compatible; JobAgent/1.0; personal job alerts)"
RETRY_STATUSES = {429, 500, 502, 503, 504}


class HttpClient:
    def __init__(self, timeout: float = 25.0, retries: int = 2, backoff: float = 2.0):
        self.timeout = timeout
        self.retries = retries
        self.backoff = backoff
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": USER_AGENT,
            "Accept-Language": "ru,en;q=0.8",
        })

    def get(self, url: str, *, params=None, headers=None) -> requests.Response:
        last_exc: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                resp = self.session.get(url, params=params, headers=headers, timeout=self.timeout)
                if resp.status_code in RETRY_STATUSES and attempt < self.retries:
                    wait = self._retry_after(resp) or self.backoff * (attempt + 1)
                    log.debug("%s -> %s, повтор через %.0fс", url, resp.status_code, wait)
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp
            except (requests.ConnectionError, requests.Timeout) as exc:
                last_exc = exc
                if attempt < self.retries:
                    time.sleep(self.backoff * (attempt + 1))
                    continue
                raise
        assert last_exc is not None
        raise last_exc

    def get_json(self, url: str, **kwargs):
        headers = {"Accept": "application/json", **(kwargs.pop("headers", None) or {})}
        return self.get(url, headers=headers, **kwargs).json()

    def get_text(self, url: str, **kwargs) -> str:
        resp = self.get(url, **kwargs)
        if not resp.encoding or resp.encoding.lower() == "iso-8859-1":
            resp.encoding = resp.apparent_encoding or "utf-8"
        return resp.text

    @staticmethod
    def _retry_after(resp: requests.Response) -> float | None:
        value = resp.headers.get("Retry-After")
        if value and value.isdigit():
            return min(float(value), 30.0)
        return None
