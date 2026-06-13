"""uv-python Quarto spike runner.

This runner is intentionally small: it executes ordered Python chunks in one
shared namespace, captures text output, tracebacks, and static matplotlib figures,
then writes a structured JSON response for the Quarto engine extension.
"""

from __future__ import annotations

import ast
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import traceback
from types import ModuleType
from typing import Any, Callable
import warnings


PROTOCOL_VERSION = "uv-python.output-events/v1"
RUNTIME_MODULE_NAME = "uv_python_runtime"

CapturedWarning = dict[str, Any]
DisplayRuntime = ModuleType

os.environ.setdefault("MPLBACKEND", "Agg")

try:
    import matplotlib

    matplotlib.use("Agg", force=True)
except Exception:
    matplotlib = None  # type: ignore[assignment]


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _close_figures() -> None:
    try:
        import matplotlib.pyplot as plt

        plt.close("all")
    except Exception:
        return


def _matplotlib_baseline_options() -> dict[str, Any]:
    try:
        import matplotlib as mpl
    except Exception:
        return {}
    return {
        "figure.figsize": list(mpl.rcParams["figure.figsize"]),
        "figure.dpi": mpl.rcParams["figure.dpi"],
        "savefig.dpi": mpl.rcParams["savefig.dpi"],
        "savefig.format": mpl.rcParams["savefig.format"],
    }


def _apply_matplotlib_figure_options(
    options: dict[str, Any],
    baseline: dict[str, Any],
) -> None:
    try:
        import matplotlib as mpl
    except Exception:
        return

    width = options.get("width")
    height = options.get("height")
    dpi = options.get("dpi")
    figure_format = options.get("format", "png")
    baseline_figsize = list(baseline.get("figure.figsize", mpl.rcParams["figure.figsize"]))
    if width is not None and height is not None:
        mpl.rcParams["figure.figsize"] = [float(width), float(height)]
    elif width is not None:
        mpl.rcParams["figure.figsize"] = [float(width), baseline_figsize[1]]
    elif height is not None:
        mpl.rcParams["figure.figsize"] = [baseline_figsize[0], float(height)]
    else:
        mpl.rcParams["figure.figsize"] = baseline_figsize
    if dpi is not None:
        mpl.rcParams["figure.dpi"] = float(dpi)
        mpl.rcParams["savefig.dpi"] = float(dpi)
    else:
        mpl.rcParams["figure.dpi"] = baseline.get("figure.dpi", mpl.rcParams["figure.dpi"])
        mpl.rcParams["savefig.dpi"] = baseline.get("savefig.dpi", mpl.rcParams["savefig.dpi"])
    if figure_format in {"png", "svg"}:
        mpl.rcParams["savefig.format"] = figure_format
    else:
        mpl.rcParams["savefig.format"] = baseline.get("savefig.format", mpl.rcParams["savefig.format"])


def _figure_mime(figure_format: str) -> str:
    if figure_format == "svg":
        return "image/svg+xml"
    return "image/png"


def _capture_figures(
    figure_dir: Path,
    chunk_index: int,
    figure_options: dict[str, Any],
) -> list[dict[str, Any]]:
    try:
        import matplotlib.pyplot as plt
    except Exception:
        return []

    figures: list[dict[str, Any]] = []
    fignums = list(plt.get_fignums())
    if not fignums:
        return figures

    figure_format = str(figure_options.get("format", "png"))
    if figure_format not in {"png", "svg"}:
        raise ValueError(f"Unsupported uv-python matplotlib figure format: {figure_format}")
    savefig_kwargs: dict[str, Any] = {
        "bbox_inches": "tight",
        "format": figure_format,
    }
    if figure_options.get("dpi") is not None:
        savefig_kwargs["dpi"] = float(figure_options["dpi"])

    figure_dir.mkdir(parents=True, exist_ok=True)
    for figure_number, fignum in enumerate(fignums, start=1):
        figure = plt.figure(fignum)
        filename = f"figure-{chunk_index + 1}-{figure_number}.{figure_format}"
        path = figure_dir / filename
        figure.savefig(path, **savefig_kwargs)
        figures.append(
            {
                "path": str(path),
                "mime": _figure_mime(figure_format),
                "figureIndex": figure_number - 1,
            }
        )
    plt.close("all")
    return figures


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return True


def _spec_path(spec: importlib.machinery.ModuleSpec) -> Path | None:
    origin = spec.origin
    if origin and origin not in {"built-in", "frozen", "namespace"}:
        return Path(origin)
    locations = spec.submodule_search_locations
    if locations:
        return Path(next(iter(locations)))
    return None


def _find_user_runtime_module(
    search_roots: list[Path],
    extension_dir: Path,
) -> importlib.machinery.ModuleSpec | None:
    for root in search_roots:
        spec = importlib.machinery.PathFinder.find_spec(
            RUNTIME_MODULE_NAME,
            [str(root)],
        )
        if spec is None:
            continue
        candidate = _spec_path(spec)
        if candidate is None or not _is_relative_to(candidate, extension_dir):
            return spec
    return None


def _install_display_runtime(
    extension_dir: Path,
    search_roots: list[Path],
) -> DisplayRuntime:
    """Load the engine-owned display runtime without faking IPython.

    The module is loaded from the extension directory into ``sys.modules`` so
    ``from uv_python_runtime import ...`` works for user code. If the document or
    project already exposes a top-level ``uv_python_runtime`` module, fail fast
    rather than silently shadowing it.
    """

    runtime_path = extension_dir / RUNTIME_MODULE_NAME / "__init__.py"
    user_spec = _find_user_runtime_module(search_roots, extension_dir)
    if user_spec is not None:
        origin = _spec_path(user_spec)
        raise RuntimeError(
            f"uv-python refuses to shadow user module '{RUNTIME_MODULE_NAME}'"
            f" at {origin}. Rename the user module or the display-runtime import."
        )

    loaded = sys.modules.get(RUNTIME_MODULE_NAME)
    if loaded is not None:
        loaded_file = getattr(loaded, "__file__", None)
        if loaded_file is None or Path(loaded_file).resolve() != runtime_path.resolve():
            raise RuntimeError(
                f"uv-python display runtime name '{RUNTIME_MODULE_NAME}' is already"
                " occupied by another module."
            )
        return loaded

    spec = importlib.util.spec_from_file_location(
        RUNTIME_MODULE_NAME,
        runtime_path,
        submodule_search_locations=[str(runtime_path.parent)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load uv-python display runtime at {runtime_path}.")

    module = importlib.util.module_from_spec(spec)
    sys.modules[RUNTIME_MODULE_NAME] = module
    spec.loader.exec_module(module)
    return module


@contextlib.contextmanager
def _capture_visible_warnings() -> Any:
    """Collect warnings that pass the active Python warning filters.

    The runner must not reset or restore ``warnings.filters`` around each chunk:
    user code can intentionally configure filters in one chunk and rely on them
    later in the same shared Python process. Replacing ``warnings.showwarning``
    lets Python's normal filter machinery decide whether a warning is ignored,
    displayed, or promoted to an exception while giving the runner a structured
    event for displayed warnings.
    """

    captured: list[CapturedWarning] = []
    previous_showwarning = warnings.showwarning

    def capture_showwarning(
        message: Warning | str,
        category: type[Warning],
        filename: str,
        lineno: int,
        file: Any | None = None,
        line: str | None = None,
    ) -> None:
        captured.append(
            {
                "message": str(message),
                "category": category.__name__,
                "categoryObject": category,
                "filename": filename,
                "lineno": lineno,
                "line": line,
            }
        )

    warnings.showwarning = capture_showwarning
    try:
        yield captured
    finally:
        if warnings.showwarning is capture_showwarning:
            warnings.showwarning = previous_showwarning


def _execute_chunk_code(
    code: str,
    filename: str,
    shared_globals: dict[str, Any],
    display_last_expression: Callable[[object], None],
) -> None:
    module = ast.parse(code, filename=filename, mode="exec")
    if not module.body or not isinstance(module.body[-1], ast.Expr):
        compiled = compile(module, filename, "exec")
        exec(compiled, shared_globals)
        return

    prefix = ast.Module(body=module.body[:-1], type_ignores=module.type_ignores)
    if prefix.body:
        prefix = ast.fix_missing_locations(prefix)
        compiled_prefix = compile(prefix, filename, "exec")
        exec(compiled_prefix, shared_globals)

    expression = ast.Expression(module.body[-1].value)
    expression = ast.fix_missing_locations(expression)
    compiled_expression = compile(expression, filename, "eval")
    value = eval(compiled_expression, shared_globals)
    if value is not None:
        display_last_expression(value)


def _evaluate_inline_code(
    code: str,
    filename: str,
    shared_globals: dict[str, Any],
    display_inline_expression: Callable[[object], None],
) -> None:
    expression = ast.parse(code, filename=filename, mode="eval")
    compiled_expression = compile(expression, filename, "eval")
    value = eval(compiled_expression, shared_globals)
    if value is not None:
        display_inline_expression(value)


def run(request_path: Path, response_path: Path) -> int:
    request = json.loads(request_path.read_text(encoding="utf-8"))
    document_path = Path(request["documentPath"])
    document_cwd = Path(request["documentCwd"])
    project_root = Path(request["projectRoot"])
    figure_dir = Path(request["figureDir"])
    extension_dir = Path(__file__).resolve().parent

    os.chdir(document_cwd)
    for import_root in (project_root, document_cwd):
        import_path = str(import_root)
        if import_path not in sys.path:
            sys.path.insert(0, import_path)
    display_runtime = _install_display_runtime(
        extension_dir,
        [project_root, document_cwd],
    )
    matplotlib_baseline = _matplotlib_baseline_options()

    shared_globals: dict[str, Any] = {
        "__name__": "__main__",
        "__file__": str(document_path),
        "params": dict(request.get("params", {})),
    }
    response: dict[str, Any] = {
        "protocol": PROTOCOL_VERSION,
        "events": [],
        "failed": False,
    }
    next_sequence = 0

    def add_event(
        kind: str,
        chunk_index: int,
        payload: dict[str, Any],
        metadata: dict[str, Any] | None = None,
        inline_index: int | None = None,
    ) -> dict[str, Any]:
        nonlocal next_sequence
        event: dict[str, Any] = {
            "protocol": PROTOCOL_VERSION,
            "kind": kind,
            "sequence": next_sequence,
            "chunkIndex": chunk_index,
            "payload": payload,
        }
        if inline_index is not None:
            event["inlineIndex"] = inline_index
        if metadata:
            event["metadata"] = metadata
        response["events"].append(event)
        next_sequence += 1
        return event

    chunks_by_index = {int(chunk["index"]): chunk for chunk in request["chunks"]}
    execution_items = request.get("items")
    if execution_items is None:
        execution_items = [
            {"kind": "chunk", "chunkIndex": int(chunk["index"])}
            for chunk in request["chunks"]
        ]

    for item in execution_items:
        item_kind = str(item.get("kind", "chunk"))
        inline_index = int(item["inlineIndex"]) if item_kind == "inline" else None
        if item_kind == "inline":
            index = int(item.get("chunkIndex", -1))
            options = item["options"]
            code = str(item["code"])
            figure_options = {"format": "png"}
        else:
            index = int(item["chunkIndex"])
            chunk = chunks_by_index[index]
            options = chunk["options"]
            code = str(chunk["code"])
            figure_options = chunk.get("figure", {"format": "png"})
        if item_kind == "chunk":
            _apply_matplotlib_figure_options(figure_options, matplotlib_baseline)

        if not options.get("eval", True):
            add_event(
                "skipped",
                index,
                {"reason": "eval_false"},
                {"fatal": False},
                inline_index,
            )
            continue

        stdout = io.StringIO()
        stderr = io.StringIO()
        captured_warnings: list[CapturedWarning] = []
        active_warnings = captured_warnings
        exc_traceback = ""
        exc: BaseException | None = None
        error_event: dict[str, Any] | None = None

        def flush_text_events() -> None:
            stdout_text = stdout.getvalue()
            stderr_text = stderr.getvalue()
            if stdout_text:
                add_event(
                    "stdout",
                    index,
                    {"text": stdout_text},
                    {"stream": "stdout"},
                    inline_index,
                )
                stdout.seek(0)
                stdout.truncate(0)
            if stderr_text:
                add_event(
                    "stderr",
                    index,
                    {"text": stderr_text},
                    {"stream": "stderr"},
                    inline_index,
                )
                stderr.seek(0)
                stderr.truncate(0)

        def emit_display_event(
            kind: str,
            payload: dict[str, Any],
            metadata: dict[str, Any] | None = None,
        ) -> None:
            flush_text_events()
            if inline_index is not None and kind in {"display_markdown", "display_html"}:
                source = (metadata or {}).get("source")
                if source not in {"display", "inline_expression"}:
                    text = str(payload.get("markdown", "") if kind == "display_markdown" else payload.get("html", ""))
                    add_event(
                        "display_text",
                        index,
                        {"text": text},
                        {"source": "inline_display_protocol_text", "originalSource": source},
                        inline_index,
                    )
                    return
            add_event(kind, index, payload, metadata, inline_index)

        def display_last_expression(value: object) -> None:
            display_runtime._display_value(value, source="last_expression")

        def display_inline_expression(value: object) -> None:
            text_type = getattr(display_runtime, "Text")
            markdown_type = getattr(display_runtime, "Markdown")
            html_type = getattr(display_runtime, "HTML")
            if isinstance(value, text_type):
                emit_display_event(
                    "display_text",
                    {"text": str(value.value)},
                    {"source": "inline_expression"},
                )
            elif isinstance(value, (markdown_type, html_type)):
                display_runtime._display_value(value, source="inline_expression")
            else:
                emit_display_event(
                    "display_text",
                    {"text": str(value)},
                    {"source": "inline_expression"},
                )

        try:
            display_runtime._set_display_handler(emit_display_event)
            with _capture_visible_warnings() as warning_records, contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                active_warnings = warning_records
                if item_kind == "inline":
                    _evaluate_inline_code(
                        code,
                        f"{document_path}#inline-{(inline_index or 0) + 1}",
                        shared_globals,
                        display_inline_expression,
                    )
                else:
                    _execute_chunk_code(
                        code,
                        f"{document_path}#chunk-{index + 1}",
                        shared_globals,
                        display_last_expression,
                    )
                captured_warnings = list(warning_records)
        except Exception as error:
            exc = error
            exc_traceback = traceback.format_exc()
            captured_warnings = list(active_warnings)
        finally:
            display_runtime._clear_display_handler()
            flush_text_events()
            if options.get("warning", True):
                for warning in captured_warnings:
                    formatted = warnings.formatwarning(
                        warning["message"],
                        warning["categoryObject"],
                        warning["filename"],
                        warning["lineno"],
                        line=warning["line"],
                    )
                    add_event(
                        "warning",
                        index,
                        {
                            "message": warning["message"],
                            "category": warning["category"],
                            "filename": warning["filename"],
                            "lineno": warning["lineno"],
                        },
                        {"formatted": formatted},
                        inline_index,
                    )
            if exc_traceback:
                fatal = item_kind == "inline" or not options.get("error", False)
                error_event = add_event(
                    "error",
                    index,
                    {
                        "traceback": exc_traceback,
                        "ename": type(exc).__name__ if exc is not None else "Exception",
                        "evalue": str(exc) if exc is not None else "",
                    },
                    {
                        "fatal": fatal,
                        "allowedByOption": not fatal,
                    },
                    inline_index,
                )
            fatal_error = bool(exc_traceback and (item_kind == "inline" or not options.get("error", False)))
            if fatal_error:
                _close_figures()
            elif item_kind == "chunk" and options.get("output", True):
                for figure in _capture_figures(figure_dir, index, figure_options):
                    figure_index = int(figure["figureIndex"])
                    add_event(
                        "figure",
                        index,
                        {"path": figure["path"], "mime": figure["mime"]},
                        {"figureIndex": figure_index},
                    )
            else:
                _close_figures()

        if exc_traceback and (item_kind == "inline" or not options.get("error", False)):
            response["failed"] = True
            if item_kind == "inline":
                response["failedInline"] = inline_index
            else:
                response["failedChunk"] = index
            if error_event is not None:
                response["failedSequence"] = error_event["sequence"]
            _write_json(response_path, response)
            print(exc_traceback, file=sys.stderr, end="")
            return 1

    _write_json(response_path, response)
    return 0


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(
            "usage: runner.py <request-json> <response-json>",
            file=sys.stderr,
        )
        return 2
    return run(Path(argv[1]), Path(argv[2]))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
