#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd -- "${script_dir}/.." && pwd)"
cd "${root_dir}"

include_venv=false
dry_run=false

usage() {
  cat <<'EOF'
Usage: ./scripts/clean.sh [--dry-run] [--venv]

Remove generated Quarto artifacts only:
  - .quarto/
  - examples/**/*.html
  - examples/**/*_files/
  - examples/parity/figures.md
  - examples/parity/figures-multiformat.md
  - **/*.quarto_ipynb

Pass --dry-run to print what would be removed without deleting anything.
Pass --venv to also remove .venv/. The default keeps .venv/ intact.
EOF
}

fail() {
  printf 'clean: %s\n' "$*" >&2
  exit 1
}

for arg in "$@"; do
  case "${arg}" in
    --dry-run)
      dry_run=true
      ;;
    --venv)
      include_venv=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "unknown argument: ${arg}"
      ;;
  esac
done

shopt -s nullglob globstar

targets=()
declare -A seen_targets=()

add_target() {
  local target="$1"
  [[ -n "${seen_targets[${target}]:-}" ]] && return 0
  seen_targets["${target}"]=1
  targets+=("${target}")
}

add_target "${root_dir}/.quarto"
add_target "${root_dir}/examples/parity/figures.md"
add_target "${root_dir}/examples/parity/figures-multiformat.md"

for path in \
  "${root_dir}"/examples/*.html \
  "${root_dir}"/examples/*_files \
  "${root_dir}"/examples/**/*.html \
  "${root_dir}"/examples/**/*_files \
  "${root_dir}"/**/*.quarto_ipynb
do
  add_target "${path}"
done

if [[ "${include_venv}" == true ]]; then
  add_target "${root_dir}/.venv"
fi

found=false
for target in "${targets[@]}"; do
  [[ -e "${target}" ]] || continue
  rel="${target#"${root_dir}/"}"
  if [[ "${target}" != "${root_dir}/.quarto" \
    && "${target}" != "${root_dir}/examples/parity/figures.md" \
    && "${target}" != "${root_dir}/examples/parity/figures-multiformat.md" \
    && "${rel}" != examples/*.html \
    && "${rel}" != examples/*_files \
    && "${rel}" != *.quarto_ipynb \
    && !( "${include_venv}" == true && "${target}" == "${root_dir}/.venv" ) ]]; then
    fail "refusing to remove unexpected path: ${target}"
  fi
  found=true
  if [[ "${dry_run}" == true ]]; then
    printf 'clean: would remove %s\n' "${rel}"
  else
    printf 'clean: removing %s\n' "${rel}"
    rm -rf -- "${target}"
  fi
done

if [[ "${found}" == false ]]; then
  printf 'clean: no generated artifacts found\n'
fi
