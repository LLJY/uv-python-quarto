"""Lightweight display helpers for the uv-python Quarto engine.

This module is intentionally small and no-Jupyter. It is made importable by the
uv-python runner while user code executes; it is not an IPython compatibility
layer and does not provide MIME bundles, display IDs, widgets, or magics.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


DisplayHandler = Callable[[str, dict[str, Any], dict[str, Any] | None], None]

_display_handler: DisplayHandler | None = None


@dataclass(frozen=True)
class Text:
    """Plain text display wrapper.

    The value is converted with ``str()`` and emitted as escaped/fenced text by
    the renderer. Markdown-looking or HTML-looking text remains literal text.
    """

    value: object


@dataclass(frozen=True)
class Markdown:
    """Explicit raw Markdown display wrapper."""

    markdown: str

    def __post_init__(self) -> None:
        if not isinstance(self.markdown, str):
            raise TypeError("uv_python_runtime.Markdown expects a str value")


@dataclass(frozen=True)
class HTML:
    """Explicit author-trusted raw HTML display wrapper."""

    html: str

    def __post_init__(self) -> None:
        if not isinstance(self.html, str):
            raise TypeError("uv_python_runtime.HTML expects a str value")


def display(value: object) -> None:
    """Emit exactly one display event for ``value``.

    Representation order is: explicit uv-python wrappers, ``_repr_markdown_()``,
    ``_repr_html_()``, ``to_markdown()``, ``to_html()``, then ``repr(value)`` as
    plain text.
    """

    _display_value(value, source="display")


def _set_display_handler(handler: DisplayHandler) -> None:
    global _display_handler
    _display_handler = handler


def _clear_display_handler() -> None:
    global _display_handler
    _display_handler = None


def _display_value(value: object, *, source: str) -> None:
    handler = _display_handler
    if handler is None:
        raise RuntimeError(
            "uv_python_runtime.display() is only available while executing "
            "with the uv-python Quarto engine"
        )

    kind, payload, metadata = _display_representation(value, source=source)
    handler(kind, payload, metadata)


def _display_representation(
    value: object,
    *,
    source: str,
) -> tuple[str, dict[str, Any], dict[str, Any] | None]:
    if isinstance(value, Text):
        return "display_text", {"text": str(value.value)}, {"source": source}
    if isinstance(value, Markdown):
        return "display_markdown", {"markdown": value.markdown}, {"source": source}
    if isinstance(value, HTML):
        return (
            "display_html",
            {"html": value.html},
            {"source": source, "trusted": True},
        )

    markdown_repr = _call_string_protocol(value, "_repr_markdown_")
    if markdown_repr is not None:
        return (
            "display_markdown",
            {"markdown": markdown_repr},
            {"source": "_repr_markdown_"},
        )

    html_repr = _call_string_protocol(value, "_repr_html_")
    if html_repr is not None:
        return (
            "display_html",
            {"html": html_repr},
            {"source": "_repr_html_", "trusted": True},
        )

    markdown_method = _call_string_protocol(value, "to_markdown")
    if markdown_method is not None:
        return (
            "display_markdown",
            {"markdown": markdown_method},
            {"source": "to_markdown"},
        )

    html_method = _call_string_protocol(value, "to_html")
    if html_method is not None:
        return (
            "display_html",
            {"html": html_method},
            {"source": "to_html", "trusted": True},
        )

    fallback_source = "last_expression" if source == "last_expression" else "repr"
    return "display_text", {"text": repr(value)}, {"source": fallback_source}


def _call_string_protocol(value: object, name: str) -> str | None:
    method = getattr(value, name, None)
    if method is None:
        return None
    if not callable(method):
        return None
    result = method()
    if not isinstance(result, str):
        raise TypeError(f"uv_python_runtime display protocol {name}() must return str")
    return result


__all__ = ["display", "Markdown", "HTML", "Text"]
