#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd -- "${script_dir}/.." && pwd)"
cd "${root_dir}"

fail() {
  printf 'ecosystem: %s\n' "$*" >&2
  exit 1
}

log() {
  printf 'ecosystem: %s\n' "$*"
}

temp_dir="$(mktemp -d)"
invalid_logs=()
cleanup() {
  rm -rf -- "${temp_dir}"
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

assert_render_fails_before_uv() {
  local qmd="$1"
  local expected="$2"
  local log_file
  log_file="$(mktemp)"
  invalid_logs+=("${log_file}")
  if quarto render "${qmd}" >"${log_file}" 2>&1; then
    fail "${qmd} unexpectedly rendered successfully"
  fi
  assert_file_contains "${log_file}" "${expected}"
  assert_file_not_contains "${log_file}" "Command: uv"
}

assert_render_fails_with_command() {
  local qmd="$1"
  local expected="$2"
  local command_prefix="$3"
  local log_file
  log_file="$(mktemp)"
  invalid_logs+=("${log_file}")
  if quarto render "${qmd}" >"${log_file}" 2>&1; then
    fail "${qmd} unexpectedly rendered successfully"
  fi
  assert_file_contains "${log_file}" "${expected}"
  assert_file_contains "${log_file}" "${command_prefix}"
}

assert_core_optional_specs_absent() {
  uv run python - <<'PY'
from pathlib import Path
import re

forbidden = {"pandas", "polars", "plotnine", "tabulate"}
pyproject = Path("pyproject.toml").read_text(encoding="utf-8")
for name in forbidden:
    if re.search(rf'["\']{name}(?:[<>=~! ,"\']|$)', pyproject, flags=re.I):
        raise SystemExit(f"unexpected optional package in pyproject.toml: {name}")

lock = Path("uv.lock").read_text(encoding="utf-8")
found = sorted(
    name for name in forbidden
    if re.search(rf'^name = "{re.escape(name)}"$', lock, flags=re.M)
)
if found:
    raise SystemExit(f"unexpected optional packages in uv.lock: {', '.join(found)}")
PY
}

assert_plain_uv_lacks_optional_imports() {
  uv run python - <<'PY'
import importlib.util

packages = ["pandas", "polars", "plotnine", "tabulate"]
found = [package for package in packages if importlib.util.find_spec(package) is not None]
if found:
    raise SystemExit(f"unexpected optional packages importable in plain uv run: {', '.join(found)}")
PY
}

cp pyproject.toml "${temp_dir}/pyproject.toml.before"
cp uv.lock "${temp_dir}/uv.lock.before"

log "building TypeScript extension"
quarto call build-ts-extension

log "checking baseline dependency boundary"
assert_core_optional_specs_absent
assert_plain_uv_lacks_optional_imports

log "rendering pandas ecosystem fixture"
quarto render examples/ecosystem/pandas.qmd

log "rendering polars ecosystem fixture"
quarto render examples/ecosystem/polars.qmd

log "rendering plotnine ecosystem fixture"
quarto render examples/ecosystem/plotnine.qmd

log "rendering dataframe limit ecosystem fixture"
quarto render examples/ecosystem/dataframe-limits.qmd

log "checking pandas output"
pandas_html="examples/ecosystem/pandas.html"
assert_file_contains "${pandas_html}" "Table&nbsp;1: Pandas dataframe rendered by uv-python"
assert_file_contains "${pandas_html}" '<a href="#tbl-ecosystem-pandas" class="quarto-xref">Table&nbsp;1</a>'
assert_file_not_contains "${pandas_html}" "@tbl-ecosystem-pandas"
assert_file_contains "${pandas_html}" "<th>person_id</th>"
assert_file_contains "${pandas_html}" "literal | pipe"
assert_file_contains "${pandas_html}" "line one"
assert_file_contains "${pandas_html}" "line two"
assert_file_contains "${pandas_html}" "backtick"
assert_file_contains "${pandas_html}" "series_value"
assert_file_not_contains "${pandas_html}" 'class="dataframe"'

log "checking polars output"
polars_html="examples/ecosystem/polars.html"
assert_file_contains "${polars_html}" "Table&nbsp;1: Polars dataframe rendered by uv-python"
assert_file_contains "${polars_html}" '<a href="#tbl-ecosystem-polars" class="quarto-xref">Table&nbsp;1</a>'
assert_file_not_contains "${polars_html}" "@tbl-ecosystem-polars"
assert_file_contains "${polars_html}" "literal | pipe"
assert_file_contains "${polars_html}" "line one"
assert_file_contains "${polars_html}" "line two"
assert_file_contains "${polars_html}" "series_value"
assert_file_not_contains "${polars_html}" "shape:"

log "checking plotnine output"
plotnine_html="examples/ecosystem/plotnine.html"
assert_file_contains "${plotnine_html}" "Figure&nbsp;1: Plotnine figure rendered by uv-python"
assert_file_contains "${plotnine_html}" '<a href="#fig-ecosystem-plotnine" class="quarto-xref">Figure&nbsp;1</a>'
assert_file_not_contains "${plotnine_html}" "@fig-ecosystem-plotnine"
assert_file_not_contains "${plotnine_html}" "plotnine.ggplot"
assert_file_not_contains "${plotnine_html}" "&lt;ggplot"
uv run python - <<'PY'
from pathlib import Path
import re

html_path = Path("examples/ecosystem/plotnine.html")
html = html_path.read_text(encoding="utf-8")
links = re.findall(r'"(plotnine_files/uv-python/html/figure-[^"]+\.png)"', html)
if len(links) != 2:
    raise SystemExit(f"expected exactly 2 plotnine figure links, found {len(links)}: {links!r}")
for rel in links:
    if not (html_path.parent / rel).is_file():
        raise SystemExit(f"plotnine figure link does not resolve: {rel}")
artifacts = sorted(path.name for path in (html_path.parent / "plotnine_files" / "uv-python" / "html").glob("figure-*.png"))
if artifacts != ["figure-1-1.png", "figure-2-1.png"]:
    raise SystemExit(f"unexpected plotnine figure artifacts: {artifacts!r}")
PY

log "checking dataframe display limits"
limits_html="examples/ecosystem/dataframe-limits.html"
assert_file_contains "${limits_html}" "<th>row_id</th>"
assert_file_contains "${limits_html}" "<th>c0</th>"
assert_file_contains "${limits_html}" "<th>c5</th>"
assert_file_contains "${limits_html}" "…"
assert_file_contains "${limits_html}" "r0c0"
assert_file_contains "${limits_html}" "r7c5"
assert_file_not_contains "${limits_html}" "<th>c3</th>"
assert_file_not_contains "${limits_html}" "r3c0"

log "checking invalid uv-python.with fixtures"
assert_render_fails_before_uv examples/ecosystem/invalid-with-scalar.qmd "uv-python metadata 'uv-python.with' must be a list"
assert_render_fails_before_uv examples/ecosystem/invalid-with-blank.qmd "uv-python metadata 'uv-python.with' entry 1 must not be empty"
assert_render_fails_before_uv examples/ecosystem/invalid-with-non-string.qmd "uv-python metadata 'uv-python.with' entry 2 must be a string"
assert_render_fails_before_uv examples/ecosystem/invalid-with-dash.qmd "must be a package requirement, not a uv option"

log "checking uv-python.with diagnostic argv"
assert_render_fails_with_command \
  examples/ecosystem/with-runtime-error.qmd \
  "ECOSYSTEM_WITH_RUNTIME_ERROR" \
  "Command: uv run --with pandas --with plotnine python"

log "checking dependency pollution"
assert_core_optional_specs_absent
assert_plain_uv_lacks_optional_imports
cmp -s pyproject.toml "${temp_dir}/pyproject.toml.before" || fail "pyproject.toml changed during ecosystem validation"
cmp -s uv.lock "${temp_dir}/uv.lock.before" || fail "uv.lock changed during ecosystem validation"

log "ok"
