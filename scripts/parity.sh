#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd -- "${script_dir}/.." && pwd)"
cd "${root_dir}"

fail() {
  printf 'parity: %s\n' "$*" >&2
  exit 1
}

log() {
  printf 'parity: %s\n' "$*"
}

invalid_logs=()
cleanup() {
  if [[ ${#invalid_logs[@]} -gt 0 ]]; then
    rm -f -- "${invalid_logs[@]}"
  fi
}
trap cleanup EXIT

assert_file_contains() {
  local file="$1"
  local needle="$2"
  [[ -f "${file}" ]] || fail "expected file not found: ${file}"
  uv run python - "${file}" "${needle}" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
needle = sys.argv[2]
text = path.read_text(encoding="utf-8")
if needle not in text:
    raise SystemExit(f"expected {path} to contain {needle!r}")
PY
}

assert_file_not_contains() {
  local file="$1"
  local needle="$2"
  [[ -f "${file}" ]] || fail "expected file not found: ${file}"
  uv run python - "${file}" "${needle}" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
needle = sys.argv[2]
text = path.read_text(encoding="utf-8")
if needle in text:
    raise SystemExit(f"expected {path} not to contain {needle!r}")
PY
}

assert_render_fails() {
  local qmd="$1"
  local expected="$2"
  local log_file
  log_file="$(mktemp)"
  invalid_logs+=("${log_file}")
  if quarto render "${qmd}" >"${log_file}" 2>&1; then
    fail "${qmd} unexpectedly rendered successfully"
  fi
  assert_file_contains "${log_file}" "${expected}"
}

assert_warning_runner_regressions() {
  uv run python - <<'PY'
from pathlib import Path
import json
import shutil
import subprocess
import sys
import tempfile

root = Path.cwd()
runner = root / "_extensions" / "uv-python" / "runner.py"


def run_chunks(chunks):
    temp_dir = Path(tempfile.mkdtemp(prefix="uv-python-warning-parity-"))
    try:
        request_path = temp_dir / "request.json"
        response_path = temp_dir / "response.json"
        request = {
            "chunks": chunks,
            "documentPath": str(root / "examples" / "parity" / "warning-regression.qmd"),
            "documentCwd": str(root),
            "projectRoot": str(root),
            "figureDir": str(temp_dir / "figures"),
        }
        request_path.write_text(json.dumps(request, indent=2), encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(runner), str(request_path), str(response_path)],
            cwd=root,
            text=True,
            capture_output=True,
        )
        response = json.loads(response_path.read_text(encoding="utf-8")) if response_path.exists() else None
        return result, response
    finally:
        shutil.rmtree(temp_dir)


defaults = {
    "eval": True,
    "echo": False,
    "include": True,
    "output": True,
    "warning": True,
    "error": False,
}

filter_result, filter_response = run_chunks([
    {
        "index": 0,
        "code": 'import warnings\nwarnings.filterwarnings("error")\nprint("filter configured")',
        "options": defaults,
    },
    {
        "index": 1,
        "code": 'import warnings\nwarnings.warn("filter persistence regression")',
        "options": defaults,
    },
])
if filter_result.returncode == 0:
    raise SystemExit("warning filter persistence regression: runner unexpectedly succeeded")
if filter_response is None:
    raise SystemExit("warning filter persistence regression: runner wrote no response")
filter_events = filter_response["events"]
filter_error_events = [event for event in filter_events if event["kind"] == "error" and event["chunkIndex"] == 1]
filter_warning_events = [event for event in filter_events if event["kind"] == "warning" and event["chunkIndex"] == 1]
if not filter_response.get("failed") or filter_response.get("failedChunk") != 1:
    raise SystemExit(f"warning filter persistence regression: unexpected failure metadata {filter_response!r}")
if len(filter_error_events) != 1 or filter_error_events[0]["payload"].get("ename") != "UserWarning":
    raise SystemExit(f"warning filter persistence regression: expected one UserWarning error event, got {filter_error_events!r}")
if filter_warning_events:
    raise SystemExit(f"warning filter persistence regression: promoted warning also emitted warning events {filter_warning_events!r}")

syntax_result, syntax_response = run_chunks([
    {
        "index": 0,
        "code": "if 1 is 1:\n    pass\n",
        "options": defaults,
    },
])
if syntax_result.returncode != 0:
    raise SystemExit(f"compile-time SyntaxWarning regression: runner failed\nstdout={syntax_result.stdout}\nstderr={syntax_result.stderr}")
if syntax_response is None:
    raise SystemExit("compile-time SyntaxWarning regression: runner wrote no response")
syntax_warning_events = [event for event in syntax_response["events"] if event["kind"] == "warning"]
if len(syntax_warning_events) != 1:
    raise SystemExit(f"compile-time SyntaxWarning regression: expected one warning event, got {syntax_warning_events!r}")
syntax_warning = syntax_warning_events[0]
if syntax_warning["payload"].get("category") != "SyntaxWarning":
    raise SystemExit(f"compile-time SyntaxWarning regression: wrong category {syntax_warning!r}")
if '"is" with \'int\' literal' not in syntax_warning["payload"].get("message", ""):
    raise SystemExit(f"compile-time SyntaxWarning regression: wrong message {syntax_warning!r}")
PY
}

assert_no_jupyter_dependency_regression() {
  uv run python - <<'PY'
import importlib.util

packages = ["jupyter", "jupyter_core", "ipykernel", "nbclient", "notebook", "IPython"]
found = [package for package in packages if importlib.util.find_spec(package) is not None]
if found:
    raise SystemExit(f"unexpected Jupyter/IPython-related packages in uv environment: {', '.join(found)}")
PY
}

assert_runner_event_protocol_regressions() {
  uv run python - <<'PY'
from pathlib import Path
import json
import shutil
import subprocess
import sys
import tempfile

root = Path.cwd()
runner = root / "_extensions" / "uv-python" / "runner.py"
temp_dir = Path(tempfile.mkdtemp(prefix="uv-python-event-parity-"))
try:
    request_path = temp_dir / "request.json"
    response_path = temp_dir / "response.json"
    defaults = {
        "eval": True,
        "echo": False,
        "include": True,
        "output": True,
        "warning": True,
        "error": False,
    }
    skipped = {**defaults, "eval": False}
    request = {
        "chunks": [
            {
                "index": 0,
                "code": """
import sys
import warnings
from uv_python_runtime import display, Markdown, HTML, Text

shared_inline_value = "INLINE_FROM_DIRECT_RUNNER"
print("EVENT_STDOUT")
sys.stderr.write("EVENT_STDERR\\n")
warnings.warn("EVENT_WARNING")
display(Text("EVENT_TEXT"))
display(Markdown("**EVENT_MARKDOWN**"))
display(HTML("<span>EVENT_HTML</span>"))
"EVENT_LAST_EXPR"
""",
                "options": defaults,
            },
            {
                "index": 1,
                "code": "print('EVENT_SHOULD_SKIP')",
                "options": skipped,
            },
        ],
        "items": [
            {"kind": "chunk", "chunkIndex": 0},
            {"kind": "inline", "inlineIndex": 0, "chunkIndex": 0, "code": "shared_inline_value", "options": defaults},
            {"kind": "chunk", "chunkIndex": 1},
        ],
        "documentPath": str(root / "examples" / "parity" / "event-protocol-regression.qmd"),
        "documentCwd": str(root),
        "projectRoot": str(root),
        "figureDir": str(temp_dir / "figures"),
    }
    request_path.write_text(json.dumps(request, indent=2), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, str(runner), str(request_path), str(response_path)],
        cwd=root,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        raise SystemExit(f"event protocol regression: runner failed\nstdout={result.stdout}\nstderr={result.stderr}")
    response = json.loads(response_path.read_text(encoding="utf-8"))
finally:
    shutil.rmtree(temp_dir)

if response.get("protocol") != "uv-python.output-events/v1":
    raise SystemExit(f"event protocol regression: wrong protocol {response.get('protocol')!r}")
if response.get("failed"):
    raise SystemExit(f"event protocol regression: unexpected failed response {response!r}")
events = response.get("events", [])
sequences = [event.get("sequence") for event in events]
if sequences != list(range(len(events))):
    raise SystemExit(f"event protocol regression: non-monotonic sequences {sequences!r}")
kinds = [event.get("kind") for event in events]
expected_kinds = [
    "stdout",
    "stderr",
    "display_text",
    "display_markdown",
    "display_html",
    "display_text",
    "warning",
    "display_text",
    "skipped",
]
if kinds != expected_kinds:
    raise SystemExit(f"event protocol regression: expected kinds {expected_kinds!r}, got {kinds!r}")
payload_checks = [
    (0, "text", "EVENT_STDOUT\n"),
    (1, "text", "EVENT_STDERR\n"),
    (2, "text", "EVENT_TEXT"),
    (3, "markdown", "**EVENT_MARKDOWN**"),
    (4, "html", "<span>EVENT_HTML</span>"),
    (5, "text", "'EVENT_LAST_EXPR'"),
    (6, "message", "EVENT_WARNING"),
    (7, "text", "INLINE_FROM_DIRECT_RUNNER"),
    (8, "reason", "eval_false"),
]
for index, key, expected in payload_checks:
    actual = events[index].get("payload", {}).get(key)
    if actual != expected:
        raise SystemExit(f"event protocol regression: event {index} payload {key!r} expected {expected!r}, got {actual!r}")
if events[7].get("inlineIndex") != 0 or events[7].get("chunkIndex") != 0:
    raise SystemExit(f"event protocol regression: inline event metadata wrong {events[7]!r}")
if any("EVENT_SHOULD_SKIP" in json.dumps(event) for event in events):
    raise SystemExit(f"event protocol regression: skipped chunk executed {events!r}")
PY
}

log "building TypeScript extension"
quarto call build-ts-extension

log "checking no-Jupyter dependency boundary"
assert_no_jupyter_dependency_regression

log "rendering options parity fixture"
quarto render examples/parity/options.qmd

log "rendering R-lab compatibility parity fixture"
quarto render examples/parity/r-lab-compat.qmd

log "rendering display parity fixture"
quarto render examples/parity/display.qmd

log "rendering tables parity fixture"
quarto render examples/parity/tables.qmd

log "rendering figures parity fixture"
quarto render examples/parity/figures.qmd
quarto render examples/parity/figures.qmd

log "rendering multi-format figures parity fixture"
quarto render examples/parity/figures-multiformat.qmd

log "rendering inline parity fixture"
quarto render examples/parity/inline-context.qmd

log "rendering inline-only parity fixture"
quarto render examples/parity/inline-only.qmd

log "rendering params/context parity fixture"
quarto render examples/parity/params-context.qmd

options_html="examples/parity/options.html"
assert_file_contains "${options_html}" "document defaults execute"
assert_file_contains "${options_html}" "stderr survives warning false"
assert_file_not_contains "${options_html}" "document warning should be suppressed"
assert_file_contains "${options_html}" "chunk warning visible"
assert_file_contains "${options_html}" "Raw Markdown From Stdout"
assert_file_contains "${options_html}" "<th>name</th>"
assert_file_contains "${options_html}" "# Not Raw Heading"
assert_file_contains "${options_html}" '```{python}'
assert_file_contains "${options_html}" "#| output: false"
assert_file_contains "${options_html}" "echo fenced executed 1 time"
assert_file_not_contains "${options_html}" "hidden include false output"
assert_file_contains "${options_html}" "include false executed"
assert_file_contains "${options_html}" "eval false skipped False"
assert_file_contains "${options_html}" "allowed parity error"
assert_file_contains "${options_html}" "continued after parity options error"

compat_html="examples/parity/r-lab-compat.html"
assert_file_contains "${compat_html}" "DOC_MESSAGE_CHUNK_EXECUTED"
assert_file_not_contains "${compat_html}" "DOC_MESSAGE_SUPPRESSED"
assert_file_contains "${compat_html}" "CHUNK_MESSAGE_VISIBLE"
assert_file_not_contains "${compat_html}" "CHUNK_MESSAGE_SUPPRESSED"
assert_file_contains "${compat_html}" '<h3 class="anchored" data-anchor-id="results-alias-raw-heading">Results Alias Raw Heading</h3>'
assert_file_not_contains "${compat_html}" "RESULTS_HIDE_SHOULD_NOT_RENDER"
assert_file_contains "${compat_html}" "COMMON_OPTIONS_ACCEPTED"
assert_file_contains "${compat_html}" "DISPLAY_ALL_TEXT"
assert_file_contains "${compat_html}" "<strong>DISPLAY_ALL_MARKDOWN</strong>"
assert_file_contains "${compat_html}" "Axes last expression renders as a figure"
assert_file_contains "${compat_html}" '<a href="#fig-compat-axes" class="quarto-xref">Figure&nbsp;1</a>'
assert_file_not_contains "${compat_html}" "&lt;Axes:"
assert_file_not_contains "${compat_html}" "matplotlib.figure.Figure"
assert_file_contains "${compat_html}" "Display all figure before text"
assert_file_contains "${compat_html}" "AFTER_DISPLAY_ALL_FIGURE"
uv run python - <<'PY'
from pathlib import Path

html = Path("examples/parity/r-lab-compat.html").read_text(encoding="utf-8")
figure_index = html.find("Display all figure before text")
text_index = html.find("AFTER_DISPLAY_ALL_FIGURE")
if figure_index == -1 or text_index == -1:
    raise SystemExit("compat fixture missing display_all figure ordering markers")
if figure_index > text_index:
    raise SystemExit("display_all figure rendered after following text")
PY

display_html="examples/parity/display.html"
assert_file_contains "${display_html}" "RUNTIME_IMPORT_ENGINE_PACKAGE True"
assert_file_contains "${display_html}" "TEXT_WRAPPER_LITERAL **not markdown**"
assert_file_not_contains "${display_html}" "<strong>TEXT_WRAPPER_LITERAL</strong>"
assert_file_contains "${display_html}" "<strong>DISPLAY_MARKDOWN_WRAPPER</strong>"
assert_file_contains "${display_html}" '<span id="display-html-wrapper"><strong>DISPLAY_HTML_WRAPPER</strong></span>'
assert_file_contains "${display_html}" "<strong>REPR_MARKDOWN_OBJECT</strong>"
assert_file_contains "${display_html}" "<em>TO_MARKDOWN_OBJECT</em>"
assert_file_contains "${display_html}" '<span id="repr-html-object">REPR_HTML_OBJECT</span>'
assert_file_contains "${display_html}" '<span id="to-html-object">TO_HTML_OBJECT</span>'
assert_file_contains "${display_html}" "REPR_FALLBACK_OBJECT **not markdown**"
assert_file_not_contains "${display_html}" "<strong>REPR_FALLBACK_OBJECT</strong>"
assert_file_contains "${display_html}" "'LAST_EXPR_SIMPLE_VALUE'"
assert_file_contains "${display_html}" "'LAST_EXPR_ONLY_VALUE'"
assert_file_not_contains "${display_html}" "FIRST_EXPR_SHOULD_NOT_DISPLAY"
assert_file_not_contains "${display_html}" "ASSIGNMENT_ONLY_SHOULD_NOT_DISPLAY"
assert_file_contains "${display_html}" "# PLAIN_TEXT_NOT_HEADING"
assert_file_not_contains "${display_html}" "<strong>PLAIN_TEXT_NOT_HTML</strong>"
assert_file_contains "${display_html}" "# ASIS_TEXT_NOT_HEADING"
assert_file_contains "${display_html}" "ASIS_MARKDOWN_HEADING"
assert_file_not_contains "${display_html}" "OUTPUT_FALSE_DISPLAY_SHOULD_HIDE"
assert_file_not_contains "${display_html}" "OUTPUT_FALSE_LAST_EXPR_SHOULD_HIDE"

tables_html="examples/parity/tables.html"
assert_file_contains "${tables_html}" "<th>metric</th>"
assert_file_contains "${tables_html}" "explicit markdown table"
assert_file_contains "${tables_html}" "<th>fruit</th>"
assert_file_contains "${tables_html}" "<td>apples</td>"
assert_file_contains "${tables_html}" "Fruit counts from explicit Markdown"
assert_file_contains "${tables_html}" '<a href="#tbl-uv-python-fruit" class="quarto-xref">Table&nbsp;1</a>'
assert_file_contains "${tables_html}" '<div id="tbl-uv-python-fruit" class="quarto-float quarto-figure quarto-figure-center anchored">'
assert_file_contains "${tables_html}" "Table&nbsp;1: Fruit counts from explicit Markdown"
assert_file_contains "${tables_html}" "<p>TRAILING_PROSE_AFTER_CAPTIONED_TABLE_EVENT outside caption.</p>"
assert_file_not_contains "${tables_html}" "Table&nbsp;1: Fruit counts from explicit Markdown TRAILING_PROSE_AFTER_CAPTIONED_TABLE_EVENT"
assert_file_not_contains "${tables_html}" "@tbl-uv-python-fruit"

figures_html="examples/parity/figures.html"
assert_file_contains "${figures_html}" "DOC_FIG_SIZE 4.0x3.0 DPI 96"
assert_file_contains "${figures_html}" "CHUNK_FIG_SIZE 2.0x1.0 DPI 72"
assert_file_contains "${figures_html}" "Captioned uv-python matplotlib figure"
assert_file_contains "${figures_html}" '<a href="#fig-uv-python-captioned" class="quarto-xref">Figure&nbsp;1</a>'
assert_file_contains "${figures_html}" '<div id="fig-uv-python-captioned" class="quarto-float quarto-figure quarto-figure-left anchored"'
assert_file_contains "${figures_html}" 'alt="Alt text for uv-python captioned figure"'
assert_file_contains "${figures_html}" 'href="https://example.com/uv-python-figure"'
assert_file_contains "${figures_html}" 'width="60%"'
assert_file_contains "${figures_html}" "Chunk override SVG figure"
assert_file_contains "${figures_html}" "First multi figure caption"
assert_file_contains "${figures_html}" "Second multi figure caption"
assert_file_contains "${figures_html}" 'alt="Alt-only uv-python figure alt"'
assert_file_not_contains "${figures_html}" "@fig-uv-python-captioned"

inline_html="examples/parity/inline-context.html"
assert_file_contains "${inline_html}" "First inline sees x=1"
assert_file_contains "${inline_html}" "<code>{python} should_not_execute_yaml</code>"
assert_file_contains "${inline_html}" "records order marker 2"
assert_file_contains "${inline_html}" "Second inline sees x=2"
assert_file_contains "${inline_html}" "full order chunk-1,inline-1,chunk-2"
assert_file_contains "${inline_html}" "**INLINE_NOT_BOLD** &lt;em&gt;INLINE_NOT_HTML&lt;/em&gt;"
assert_file_not_contains "${inline_html}" "<strong>INLINE_NOT_BOLD</strong>"
assert_file_contains "${inline_html}" "<strong>INLINE_MARKDOWN_WRAPPER</strong>"
assert_file_contains "${inline_html}" '<span id="inline-html-wrapper">INLINE_HTML_WRAPPER</span>'
assert_file_contains "${inline_html}" "**INLINE_TEXT_WRAPPER_NOT_BOLD**"
assert_file_not_contains "${inline_html}" "<strong>INLINE_TEXT_WRAPPER_NOT_BOLD</strong>"
assert_file_contains "${inline_html}" "INLINE_REPR_MARKDOWN_TEXT **not bold**"
assert_file_contains "${inline_html}" "INLINE_REPR_HTML_TEXT &lt;em&gt;not html&lt;/em&gt;"
assert_file_contains "${inline_html}" "INLINE_TO_MARKDOWN_TEXT **not bold**"
assert_file_contains "${inline_html}" "INLINE_TO_HTML_TEXT &lt;em&gt;not html&lt;/em&gt;"
assert_file_not_contains "${inline_html}" "INLINE_REPR_MARKDOWN_SHOULD_NOT_RAW"
assert_file_not_contains "${inline_html}" "inline-repr-html-should-not-raw"
assert_file_not_contains "${inline_html}" "INLINE_TO_MARKDOWN_SHOULD_NOT_RAW"
assert_file_not_contains "${inline_html}" "inline-to-html-should-not-raw"
assert_file_contains "${inline_html}" "<strong>INLINE_DISPLAY_MARKDOWN_WRAPPER</strong>"
assert_file_contains "${inline_html}" '<span id="inline-display-html-wrapper">INLINE_DISPLAY_HTML_WRAPPER</span>'
assert_file_contains "${inline_html}" "**INLINE_DISPLAY_REPR_MARKDOWN_LITERAL**"
assert_file_contains "${inline_html}" "**INLINE_DISPLAY_TO_MARKDOWN_LITERAL**"
assert_file_contains "${inline_html}" "INLINE_DISPLAY_REPR_HTML_LITERAL&lt;/span&gt;"
assert_file_contains "${inline_html}" "INLINE_DISPLAY_TO_HTML_LITERAL&lt;/span&gt;"
assert_file_not_contains "${inline_html}" "<strong>INLINE_DISPLAY_REPR_MARKDOWN_LITERAL</strong>"
assert_file_not_contains "${inline_html}" "<strong>INLINE_DISPLAY_TO_MARKDOWN_LITERAL</strong>"
assert_file_not_contains "${inline_html}" '<span id="inline-display-repr-html-should-not-raw">INLINE_DISPLAY_REPR_HTML_LITERAL</span>'
assert_file_not_contains "${inline_html}" '<span id="inline-display-to-html-should-not-raw">INLINE_DISPLAY_TO_HTML_LITERAL</span>'
assert_file_contains "${inline_html}" "<code>{python} should_not_execute_inline_escape</code>"
assert_file_contains "${inline_html}" '`{python} should_not_execute_extra_backtick`'
assert_file_contains "${inline_html}" "should_not_execute_tilde_fence"
assert_file_contains "${inline_html}" "should_not_execute_indented_code"
assert_file_contains "${inline_html}" "should_not_execute_blockquote_backtick_fence"
assert_file_contains "${inline_html}" "should_not_execute_blockquote_tilde_fence"
assert_file_contains "${inline_html}" "should_not_execute_blockquote_indented_code"
assert_file_contains "${inline_html}" "should_not_execute_list_backtick_fence"
assert_file_contains "${inline_html}" "should_not_execute_list_tilde_fence"
assert_file_contains "${inline_html}" "should_not_execute_list_marker_indented_code"
assert_file_contains "${inline_html}" "should_not_execute_explicit_list_code_first"
assert_file_contains "${inline_html}" "should_not_execute_explicit_list_code_second"
assert_file_contains "${inline_html}" "List continuation inline executes: LIST_CONTINUATION_INLINE_EXECUTED"
assert_file_contains "${inline_html}" "should_not_execute_list_continuation_indented_code"

inline_only_html="examples/parity/inline-only.html"
assert_file_contains "${inline_only_html}" "inline Python still executes: 42"
assert_file_contains "${inline_only_html}" '$INLINE_DOLLAR$ ~INLINE_SUB~ ^INLINE_SUPER^ **INLINE_STRONG_NOT_RAW** &lt;em&gt;INLINE_HTML_NOT_RAW&lt;/em&gt;'
assert_file_not_contains "${inline_only_html}" 'math inline'
assert_file_not_contains "${inline_only_html}" '<sub>INLINE_SUB</sub>'
assert_file_not_contains "${inline_only_html}" '<sup>INLINE_SUPER</sup>'
assert_file_not_contains "${inline_only_html}" '<strong>INLINE_STRONG_NOT_RAW</strong>'

params_html="examples/parity/params-context.html"
assert_file_contains "${params_html}" "PARAM_ALPHA yaml-alpha"
assert_file_contains "${params_html}" "PARAM_BETA yaml-beta"
assert_file_contains "${params_html}" "PARAM_GAMMA missing"
assert_file_contains "${params_html}" "PARAM_TOP_LEVEL_ALPHA_PRESENT False"
assert_file_contains "${params_html}" "EXECUTE_INFO_ENV_PRESENT True"
assert_file_contains "${params_html}" "EXECUTE_INFO_HAS_PATH True"
assert_file_contains "${params_html}" "EXECUTE_INFO_TARGET_FORMAT html"
assert_file_contains "${params_html}" "EXECUTE_INFO_BASE_FORMAT html"
assert_file_contains "${params_html}" "EXECUTE_INFO_HAS_EXECUTE True"
assert_file_contains "${params_html}" "EXECUTE_INFO_HAS_RENDER True"
assert_file_contains "${params_html}" "EXECUTE_INFO_HAS_PANDOC True"
assert_file_contains "${params_html}" "EXECUTE_INFO_METADATA_TITLE uv-python params and context parity"
assert_file_contains "${params_html}" "QUARTO_PROJECT_DIR_ENV_PRESENT True"

log "checking params CLI override behavior"
quarto render examples/parity/params-context.qmd -P beta:cli-beta -P gamma:cli-gamma
assert_file_contains "${params_html}" "PARAM_ALPHA yaml-alpha"
assert_file_contains "${params_html}" "PARAM_BETA cli-beta"
assert_file_contains "${params_html}" "PARAM_GAMMA cli-gamma"
assert_file_contains "${params_html}" "Inline params share the same mapping: beta=cli-beta"

log "checking figures resolve and do not accumulate stale files"
uv run python - <<'PY'
from pathlib import Path
import re

html_path = Path("examples/parity/figures.html")
html = html_path.read_text(encoding="utf-8")
matches = re.findall(r'"(figures_files/uv-python/html/figure-[^"]+\.(?:png|svg))"', html)
if len(matches) != 6:
    raise SystemExit(f"expected exactly 6 figure image links, found {len(matches)}: {matches!r}")
for rel in matches:
    path = html_path.parent / rel
    if not path.is_file():
        raise SystemExit(f"uv-python parity figure link does not resolve: {rel}")
support_dir = html_path.parent / "figures_files" / "uv-python" / "html"
artifacts = sorted(path.name for path in support_dir.glob("figure-*.*"))
expected = ["figure-1-1.png", "figure-2-1.svg", "figure-3-1.png", "figure-4-1.png", "figure-5-1.png", "figure-5-2.png"]
if artifacts != expected:
    raise SystemExit(f"expected no stale figure accumulation; got {artifacts!r}")
if matches != [f"figures_files/uv-python/html/{name}" for name in expected]:
    raise SystemExit(f"unexpected figure order/format: {matches!r}")
figcaptions = re.findall(r"<figcaption[^>]*>(.*?)</figcaption>", html, flags=re.S)
for forbidden in ("Python figure", "Alt-only uv-python figure alt"):
    if any(forbidden in caption for caption in figcaptions):
        raise SystemExit(f"uncaptioned figure text leaked into a visible figcaption: {forbidden!r}")
PY

log "checking multi-format figure links resolve after all formats render"
uv run python - <<'PY'
from pathlib import Path
import re

outputs = [
    Path("examples/parity/figures-multiformat.html"),
    Path("examples/parity/figures-multiformat.md"),
]
seen_namespaces = set()
for output in outputs:
    if not output.is_file():
        raise SystemExit(f"expected multi-format output not found: {output}")
    text = output.read_text(encoding="utf-8")
    links = re.findall(r"figures-multiformat_files/uv-python/([^/]+)/figure-[^\"')\s]+\.(?:png|svg)", text)
    if not links:
        raise SystemExit(f"expected at least one uv-python figure link in {output}")
    seen_namespaces.update(links)
    for namespace in links:
        paths = re.findall(
            rf"(figures-multiformat_files/uv-python/{re.escape(namespace)}/figure-[^\"')\s]+\.(?:png|svg))",
            text,
        )
        for rel in paths:
            if not (output.parent / rel).is_file():
                raise SystemExit(f"multi-format uv-python figure link does not resolve after full render: {output}: {rel}")
if len(seen_namespaces) < 2:
    raise SystemExit(f"expected at least two format namespaces, got {sorted(seen_namespaces)!r}")
PY

log "checking invalid option failures"
assert_render_fails examples/parity/options-invalid-unsupported.qmd "Unsupported uv-python chunk option 'cache'"
assert_render_fails examples/parity/options-invalid-value.qmd "uv-python option 'output' supports only true, false, or asis values"

log "checking invalid table failures"
assert_render_fails examples/parity/tables-invalid-label.qmd "uv-python does not support mixing table metadata and figure metadata in the same chunk"
assert_render_fails examples/parity/tables-invalid-zero.qmd "uv-python tbl-cap requires exactly one Markdown pipe table display event in the chunk; found 0"
assert_render_fails examples/parity/tables-invalid-multiple.qmd "uv-python tbl-cap requires exactly one Markdown pipe table display event in the chunk; found 2"
assert_render_fails examples/parity/tables-invalid-multiple-events.qmd "uv-python tbl-cap requires exactly one Markdown pipe table display event in the chunk; found 2"
assert_render_fails examples/parity/tables-invalid-trailing.qmd "Use a separate chunk/event or remove extra content"

log "checking invalid figure failures"
assert_render_fails examples/parity/figures-invalid-caption-mismatch.qmd "uv-python fig-cap list length (1) must match the number of figures in the chunk (2)."
assert_render_fails examples/parity/figures-invalid-labeled-multiple.qmd "uv-python fig-* labels currently support exactly one figure per chunk"
assert_render_fails examples/parity/figures-invalid-label.qmd "uv-python does not support mixing table metadata and figure metadata in the same chunk"
assert_render_fails examples/parity/figures-invalid-format.qmd "uv-python chunk option 'fig-format' currently supports only png, svg, or retina values."
assert_render_fails examples/parity/figures-invalid-metadata-no-figure.qmd "uv-python figure metadata requires at least one matplotlib figure output in the chunk."

log "checking invalid inline failures"
assert_render_fails examples/parity/inline-invalid-exception.qmd "uv-python failed while executing inline expression 1."
assert_render_fails examples/parity/inline-invalid-exception.qmd "ZeroDivisionError"
assert_render_fails examples/parity/inline-invalid-figure.qmd "uv-python inline expressions do not support figure output"

log "checking warning runner regressions"
assert_warning_runner_regressions

log "checking ordered output event protocol regressions"
assert_runner_event_protocol_regressions

log "ok"
