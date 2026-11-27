"""Мелкие помощники: очистка HTML, разбор дат, форматирование зарплат."""

from __future__ import annotations

import html
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

_TAG_RE = re.compile(r"<[^>]+>")
_BR_RE = re.compile(r"<\s*(br|/p|/div|/li|/h\d)\s*/?>", re.IGNORECASE)
_WS_RE = re.compile(r"[ \t\r\f\v]+")


def html_to_text(value: str | None) -> str:
    if not value:
        return ""
    text = _BR_RE.sub("\n", value)
    text = _TAG_RE.sub(" ", text)
    text = html.unescape(text)
    lines = [_WS_RE.sub(" ", line).strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line)


def truncate(text: str, limit: int) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut.rstrip(" ,.;:-") + "…"


def parse_date(value) -> datetime | None:
    """Понимает unix-время, ISO 8601 и RFC 822 (RSS). Возвращает UTC-aware datetime."""
    if value is None or value == "":
        return None
    try:
        if isinstance(value, (int, float)) or (isinstance(value, str) and value.isdigit()):
            ts = float(value)
            if ts > 1e12:  # миллисекунды
                ts /= 1000
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        value = str(value).strip()
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            # hh.ru и некоторые другие отдают +0300 без двоеточия
            m = re.match(r"(.*[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(\d{2})$", value)
            if m:
                dt = datetime.fromisoformat(f"{m.group(1)}{m.group(2)}:{m.group(3)}")
            else:
                dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError, IndexError):
        return None


_CURRENCY = {
    "RUR": "₽", "RUB": "₽", "rub": "₽", "USD": "$", "EUR": "€", "KZT": "₸",
    "UAH": "₴", "BYR": "Br", "BYN": "Br", "GBP": "£",
}


def _num(value) -> str:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return str(value)
    return f"{number:,}".replace(",", " ")


def format_salary(min_value=None, max_value=None, currency: str | None = None) -> str:
    def present(v) -> bool:
        try:
            return v is not None and v != "" and float(v) > 0
        except (TypeError, ValueError):
            return False

    lo, hi = present(min_value), present(max_value)
    if not lo and not hi:
        return ""
    cur = _CURRENCY.get(currency or "", currency or "")
    if lo and hi and float(min_value) != float(max_value):
        text = f"{_num(min_value)}–{_num(max_value)}"
    elif lo and hi:
        text = _num(min_value)
    elif lo:
        text = f"от {_num(min_value)}"
    else:
        text = f"до {_num(max_value)}"
    return f"{text} {cur}".strip()


def join_nonempty(*parts, sep: str = ", ") -> str:
    return sep.join(str(p).strip() for p in parts if p and str(p).strip())
