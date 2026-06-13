"""Lightweight display helpers for the uv-python Quarto engine.

This module is intentionally small and no-Jupyter. It is made importable by the
uv-python runner while user code executes; it is not an IPython compatibility
layer and does not provide MIME bundles, display IDs, widgets, or magics.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any, Callable


DisplayHandler = Callable[[str, dict[str, Any], dict[str, Any] | None], None]

_display_handler: DisplayHandler | None = None
_MAX_TABLE_ROWS = 25
_MAX_TABLE_COLUMNS = 12
_ELLIPSIS = "…"
_MARKDOWN_CELL_ESCAPES = frozenset(r"\`*_{}[]()#+-.!~^")
_FIGURE_EVENT_KIND = "_uv_python_matplotlib_figure"


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

    Representation order is: explicit uv-python wrappers, optional dataframe and
    plotnine helpers when their packages are installed, ``_repr_markdown_()``,
    ``_repr_html_()``, ``to_markdown()``, ``to_html()``, then ``repr(value)`` as
    plain text.
    """

    _display_value(value, source="display")


def display_all(*values: object) -> None:
    """Emit one display event for each value, in order.

    This is a small uv-python helper for porting R/knitr-style chunks that show
    several intermediate objects. It intentionally does not change Python's
    last-expression execution semantics.
    """

    for value in values:
        _display_value(value, source="display")


def _configure(dataframe: dict[str, Any] | None = None) -> None:
    global _MAX_TABLE_ROWS, _MAX_TABLE_COLUMNS
    if dataframe is None:
        dataframe = {}
    if not isinstance(dataframe, dict):
        raise ValueError("uv_python_runtime dataframe configuration must be a mapping")
    max_rows = dataframe.get("maxRows")
    max_columns = dataframe.get("maxColumns")
    if max_rows is not None:
        _MAX_TABLE_ROWS = _configured_table_limit("maxRows", max_rows)
    if max_columns is not None:
        _MAX_TABLE_COLUMNS = _configured_table_limit("maxColumns", max_columns)


def _configured_table_limit(name: str, value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 3:
        raise ValueError(f"uv_python_runtime dataframe {name} must be an integer >= 3")
    return value


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

    dataframe_markdown = _dataframe_like_markdown(value)
    if dataframe_markdown is not None:
        return (
            "display_markdown",
            {"markdown": dataframe_markdown},
            {"source": "dataframe", "displaySource": source},
        )

    figure = _figure_display_value(value)
    if figure is not None:
        return (
            _FIGURE_EVENT_KIND,
            {"figure": figure},
            {"source": _figure_display_source(value), "displaySource": source},
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


def _dataframe_like_markdown(value: object) -> str | None:
    pandas_markdown = _pandas_markdown(value)
    if pandas_markdown is not None:
        return pandas_markdown
    return _polars_markdown(value)


def _pandas_markdown(value: object) -> str | None:
    try:
        import pandas as pd  # type: ignore[import-not-found]
    except Exception:
        return None

    if isinstance(value, pd.DataFrame):
        index_header = _index_header(value.index)
        headers = [index_header, *[_stringify_header(column, "") for column in value.columns]]
        rows = [list(row) for row in value.itertuples(index=True, name=None)]
        return _markdown_pipe_table(headers, rows, frozen_columns=1)

    if isinstance(value, pd.Series):
        value_header = _stringify_header(getattr(value, "name", None), "value")
        headers = [_index_header(value.index), value_header]
        rows = [[index, series_value] for index, series_value in value.items()]
        return _markdown_pipe_table(headers, rows, frozen_columns=1)

    return None


def _polars_markdown(value: object) -> str | None:
    try:
        import polars as pl  # type: ignore[import-not-found]
    except Exception:
        return None

    if isinstance(value, pl.DataFrame):
        columns = list(value.columns)
        headers = [_stringify_header(column, "") for column in columns]
        rows = [
            [row.get(column) for column in columns]
            for row in value.to_dicts()
        ]
        return _markdown_pipe_table(headers, rows)

    if isinstance(value, pl.Series):
        value_header = _stringify_header(getattr(value, "name", None), "value")
        rows = [[index, series_value] for index, series_value in enumerate(value.to_list())]
        return _markdown_pipe_table(["index", value_header], rows, frozen_columns=1)

    return None


def _plotnine_figure(value: object) -> object | None:
    try:
        from plotnine import ggplot  # type: ignore[import-not-found]
    except Exception:
        return None

    if not isinstance(value, ggplot):
        return None
    return value.draw(show=False)


def _figure_display_value(value: object) -> object | None:
    plotnine_figure = _plotnine_figure(value)
    if plotnine_figure is not None:
        return plotnine_figure
    return _matplotlib_figure(value)


def _figure_display_source(value: object) -> str:
    try:
        from plotnine import ggplot  # type: ignore[import-not-found]
    except Exception:
        ggplot = None  # type: ignore[assignment]
    if ggplot is not None and isinstance(value, ggplot):
        return "plotnine"
    return "matplotlib"


def _matplotlib_figure(value: object) -> object | None:
    try:
        from matplotlib.axes import Axes  # type: ignore[import-not-found]
        from matplotlib.figure import Figure  # type: ignore[import-not-found]
    except Exception:
        return None

    if isinstance(value, Figure):
        return value
    if isinstance(value, Axes):
        return value.figure

    for attribute in ("figure", "fig"):
        figure = getattr(value, attribute, None)
        if isinstance(figure, Figure):
            return figure
    return None


def _index_header(index: object) -> str:
    names = getattr(index, "names", None)
    if isinstance(names, (list, tuple)) and any(name is not None for name in names):
        return " / ".join(_stringify_header(name, "") for name in names)
    return _stringify_header(getattr(index, "name", None), "index")


def _stringify_header(value: object, fallback: str) -> str:
    if value is None:
        return fallback
    text = _stringify_scalar(value).strip()
    return text if text else fallback


def _markdown_pipe_table(
    headers: list[object],
    rows: list[list[object]],
    *,
    frozen_columns: int = 0,
) -> str:
    if not headers:
        headers = ["value"]
    normalized_rows = [_normalize_row(row, len(headers)) for row in rows]
    headers, normalized_rows = _truncate_table(headers, normalized_rows, frozen_columns=frozen_columns)
    formatted_headers = [_format_markdown_table_cell(header) for header in headers]
    lines = [
        _pipe_table_row(formatted_headers),
        _pipe_table_row(["---"] * len(formatted_headers)),
    ]
    for row in normalized_rows:
        lines.append(_pipe_table_row([_format_markdown_table_cell(cell) for cell in row]))
    return "\n".join(lines) + "\n"


def _normalize_row(row: list[object], width: int) -> list[object]:
    if len(row) == width:
        return row
    if len(row) > width:
        return row[:width]
    return [*row, *("" for _ in range(width - len(row)))]


def _truncate_table(
    headers: list[object],
    rows: list[list[object]],
    *,
    frozen_columns: int,
) -> tuple[list[object], list[list[object]]]:
    if len(headers) > _MAX_TABLE_COLUMNS:
        frozen = min(max(frozen_columns, 0), _MAX_TABLE_COLUMNS - 2, len(headers))
        visible_data_columns = _MAX_TABLE_COLUMNS - frozen - 1
        leading_count = max(0, (visible_data_columns + 1) // 2)
        trailing_count = max(0, visible_data_columns - leading_count)
        leading_indices = list(range(frozen, min(frozen + leading_count, len(headers))))
        trailing_indices = []
        if trailing_count > 0:
            trailing_start = max(frozen + len(leading_indices), len(headers) - trailing_count)
            trailing_indices = list(range(trailing_start, len(headers)))
        kept_before_ellipsis = [*range(frozen), *leading_indices]
        headers = [headers[index] for index in kept_before_ellipsis] + [_ELLIPSIS] + [
            headers[index] for index in trailing_indices
        ]
        rows = [
            [row[index] for index in kept_before_ellipsis] + [_ELLIPSIS] + [row[index] for index in trailing_indices]
            for row in rows
        ]

    if len(rows) > _MAX_TABLE_ROWS:
        leading_count = _MAX_TABLE_ROWS // 2
        trailing_count = _MAX_TABLE_ROWS - leading_count - 1
        rows = [
            *rows[:leading_count],
            [_ELLIPSIS] * len(headers),
            *rows[-trailing_count:],
        ]
    return headers, rows


def _pipe_table_row(cells: list[str]) -> str:
    return "| " + " | ".join(cells) + " |"


def _format_markdown_table_cell(value: object) -> str:
    if _is_missing_value(value):
        return ""
    text = _stringify_scalar(value).replace("\r\n", "\n").replace("\r", "\n")
    parts: list[str] = []
    for character in text:
        if character == "&":
            parts.append("&amp;")
        elif character == "<":
            parts.append("&lt;")
        elif character == ">":
            parts.append("&gt;")
        elif character == "|":
            parts.append("&#124;")
        elif character == "\n":
            parts.append("<br>")
        elif character in _MARKDOWN_CELL_ESCAPES:
            parts.append(f"\\{character}")
        else:
            parts.append(character)
    return "".join(parts)


def _is_missing_value(value: object) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    if type(value).__name__ in {"NAType", "NaTType"}:
        return True
    try:
        return bool(value != value)
    except Exception:
        return False


def _stringify_scalar(value: object) -> str:
    try:
        return str(value)
    except Exception:
        return repr(value)


__all__ = ["display", "display_all", "Markdown", "HTML", "Text"]
