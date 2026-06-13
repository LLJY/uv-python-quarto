#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd -- "${script_dir}/.." && pwd)"
cd "${root_dir}"

fail() {
  printf 'smoke: %s\n' "$*" >&2
  exit 1
}

log() {
  printf 'smoke: %s\n' "$*"
}

disallowed_log=""
cleanup() {
  if [[ -n "${disallowed_log:-}" ]]; then
    rm -f -- "${disallowed_log}"
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

log "building TypeScript extension"
quarto call build-ts-extension

log "checking uv matplotlib dependency"
uv run python -c "import matplotlib"

log "checking uv environment has no Jupyter packages"
uv run python - <<'PY'
import importlib.util

packages = ["jupyter", "jupyter_core", "ipykernel", "nbclient", "notebook"]
found = [package for package in packages if importlib.util.find_spec(package) is not None]
if found:
    raise SystemExit(f"unexpected Jupyter-related packages in uv environment: {', '.join(found)}")
PY

log "checking Quarto inspect engine selection"
uv run python - <<'PY'
import json
import subprocess


def inspect(path: str) -> dict:
    result = subprocess.run(
        ["quarto", "inspect", path],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return json.loads(result.stdout)


def selected_engine(payload: dict) -> str:
    try:
        return payload["formats"]["html"]["execute"]["engine"]
    except KeyError as exc:
        raise SystemExit(f"quarto inspect output missing expected engine field: {exc}")


basic_engine = selected_engine(inspect("examples/basic.qmd"))
if basic_engine != "uv-python":
    raise SystemExit(f"examples/basic.qmd selected {basic_engine!r}, expected 'uv-python'")

no_engine = selected_engine(inspect("examples/no-engine.qmd"))
if no_engine == "uv-python":
    raise SystemExit("examples/no-engine.qmd unexpectedly selected 'uv-python'")
PY

log "rendering passing examples"
quarto render examples/basic.qmd
quarto render examples/error-allowed.qmd

log "checking expected disallowed-error failure"
disallowed_log="$(mktemp)"
if quarto render examples/error-disallowed.qmd >"${disallowed_log}" 2>&1; then
  fail "examples/error-disallowed.qmd unexpectedly rendered successfully"
fi
assert_file_contains "${disallowed_log}" "uv-python failed"
assert_file_contains "${disallowed_log}" "Traceback"
assert_file_contains "${disallowed_log}" "disallowed spike error"

log "checking rendered HTML contents"
assert_file_contains examples/basic.html "shared state result: 42"
assert_file_contains examples/basic.html "stderr validation message"
assert_file_contains examples/error-allowed.html "allowed spike error"
assert_file_contains examples/error-allowed.html "Traceback"
assert_file_contains examples/error-allowed.html "continued after allowed error"

log "checking uv-python figure link resolves"
uv run python - <<'PY'
from pathlib import Path
import re

html_path = Path("examples/basic.html")
html = html_path.read_text(encoding="utf-8")
matches = re.findall(r'"(basic_files/uv-python/html/figure-[^"]+\.png)"', html)
if not matches:
    raise SystemExit("examples/basic.html does not contain a uv-python figure link")
for rel in matches:
    path = html_path.parent / rel
    if not path.is_file():
        raise SystemExit(f"uv-python figure link does not resolve: {rel}")
PY

log "ok"
