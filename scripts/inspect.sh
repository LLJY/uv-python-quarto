#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd -- "${script_dir}/.." && pwd)"
cd "${root_dir}"

fail() {
  printf 'inspect: %s\n' "$*" >&2
  exit 1
}

log() {
  printf 'inspect: %s\n' "$*"
}

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

log "building TypeScript extension"
quarto call build-ts-extension

log "rendering no-raw-HTML inspection examples"
quarto render examples/inspect/surface-no-raw-html.qmd
quarto render examples/inspect/dataframes-current.qmd
quarto render examples/inspect/matplotlib.qmd
quarto render examples/inspect/quarto-ui-no-raw-html.qmd

log "checking inspection outputs"
assert_file_contains examples/inspect/surface-no-raw-html.html "SURFACE_SHARED_STATE 43"
assert_file_contains examples/inspect/dataframes-current.html "DATAFRAME_STATUS"
assert_file_contains examples/inspect/dataframes-current.html "recommended dependency-free current path"
assert_file_contains examples/inspect/matplotlib.html "Figure&nbsp;1: Inspectable matplotlib line chart"
assert_file_contains examples/inspect/quarto-ui-no-raw-html.html "UI_INLINE_VALUE 12"

log "created files"
printf 'inspect:   examples/inspect/surface-no-raw-html.html\n'
printf 'inspect:   examples/inspect/dataframes-current.html\n'
printf 'inspect:   examples/inspect/matplotlib.html\n'
printf 'inspect:   examples/inspect/quarto-ui-no-raw-html.html\n'

log "ok"
