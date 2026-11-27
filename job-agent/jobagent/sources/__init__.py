"""Все подключённые сайты. Чтобы добавить новый — создай класс-наследник Source с @register."""

from . import remote_boards, rss, russian, telegram_channels  # noqa: F401  (регистрация)
from .base import REGISTRY, Source, SourceConfigError

__all__ = ["REGISTRY", "Source", "SourceConfigError"]
