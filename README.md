# uv-python Quarto engine

My prof made me learn R. I said no. So here you go.

This repository contains a uv-native Quarto engine extension named `uv-python`.
It renders Python-powered `.qmd` documents without Jupyter kernels, `nbclient`,
or notebook execution machinery. Documents opt in explicitly with:

```yaml
engine: uv-python
```

Ordinary Quarto documents that omit `engine: uv-python` are intentionally not
auto-claimed, even if they contain `{python}` chunks.

The engine executes fenced `{python}` chunks through one command launched from
the uv project root:

```bash
uv run python <runnerAbs> <requestAbs> <responseAbs>
```

Documents can request optional, transient render dependencies with
`uv-python.with`; those are passed as repeated `uv run --with` flags before the
runner command. Without that metadata, the default command above is unchanged.

The Python runner keeps one shared global namespace for the document, captures
stdout, stderr, tracebacks, and static matplotlib figures, then returns a
versioned ordered event stream for the TypeScript extension to render as
Markdown and image links. It does not use Jupyter, kernels, or `nbclient`.

## Tested local tools

- Quarto: 1.9.37
- uv: 0.11.21

The local Quarto scaffold confirmed `quarto.markdownRegex.breakQuartoMd()` and
the `ExecuteResult.supporting: string[]` return shape. TypeScript is built with:

```bash
quarto call build-ts-extension
```

## Repository layout

- `_extensions/uv-python/` — packaged Quarto extension assets and Python runner.
- `src/uv-python.ts` — TypeScript engine source; rebuilds to
  `_extensions/uv-python/uv-python.js`.
- `examples/` — baseline, parity, and inspection documents.
- `scripts/smoke.sh` — fast baseline validation.
- `scripts/parity.sh` — deeper static parity validation.
- `scripts/inspect.sh` — renders human-inspection examples without raw injected
  HTML from Python.
- `docs/` — parity matrix, output protocol, display API, and runtime API notes.

Generated Quarto outputs are ignored; source examples and extension files are
intended to be tracked.

## Installation and usage

Install the public Quarto extension from GitHub with:

```bash
quarto add LLJY/uv-python-quarto
```

Quarto installs the packaged extension contents under `_extensions/`. The
repository README, docs, scripts, and examples above `_extensions/` are
development materials rather than files installed into downstream projects.

For local development in this repository, render after rebuilding the TypeScript
extension:

```bash
quarto call build-ts-extension
quarto render examples/basic.qmd
```

Optional dataframe and plot rendering libraries stay optional. Add them to your
own uv project when you want persistent project dependencies:

```bash
uv add pandas polars plotnine
```

Or request transient dependencies per document/project render:

```yaml
engine: uv-python
uv-python:
  with:
    - pandas
    - polars
    - plotnine
```

The engine reads `uv-python.with` from Quarto's merged format metadata
(`options.format.metadata["uv-python"].with`). It must be a list of non-empty
package requirement strings; entries beginning with `-` are rejected before uv is
invoked.

Dataframe display limits can also be tuned per document/project:

```yaml
uv-python:
  dataframe:
    max-rows: 50
    max-cols: 20
```

Both values must be integers greater than or equal to 3. Defaults are 25 rows and
12 columns.

## License

GPLv2. See `LICENSE`.

The license file was fetched from the GNU project rather than handwritten.

## Validation

Run the deterministic smoke harness from the repository root:

```bash
./scripts/smoke.sh
```

From another directory, invoke the script by path (for example,
`/path/to/pymd/scripts/smoke.sh`). The script changes to the project root, fails
fast, rebuilds the TypeScript extension, checks the uv environment, verifies
`quarto inspect` engine selection for the opt-in and no-engine fixtures, renders
the passing examples, asserts the expected disallowed-error failure, and checks
key HTML output and figure links.

Run the deeper static parity harness when changing engine behavior or docs:

```bash
./scripts/parity.sh
```

The parity harness rebuilds the TypeScript extension, renders the parity fixtures,
and uses concrete assertions for supported options and invalid option failures,
warnings, ordered output events, display/last-expression output, explicit
Markdown tables and invalid table cases, static figures and invalid figure cases,
inline ordering/escaping/code-block boundaries/invalid inline errors, params,
`QUARTO_EXECUTE_INFO`, no-Jupyter dependency boundaries, and multi-format figure
artifact resolution. Current cross-format coverage is HTML plus GFM in
`examples/parity/figures-multiformat.qmd`; non-HTML coverage is intentionally
limited to static figure artifact namespacing/link resolution for this slice.

Run optional ecosystem validation when changing pandas, polars, plotnine, or
`uv-python.with` behavior:

```bash
./scripts/ecosystem.sh
```

The ecosystem harness renders `examples/ecosystem/` with transient dependencies,
checks dataframe table and plotnine figure cross-references, asserts invalid
`uv-python.with` metadata fails before uv is invoked, and verifies that
`pyproject.toml`, `uv.lock`, and plain `uv run python` remain free of pandas,
polars, plotnine, and tabulate.

Render inspection examples for manual review with:

```bash
./scripts/inspect.sh
```

This renders documents under `examples/inspect/` that avoid Python
`HTML(...)`/raw injected HTML and show the current product surface: chunks,
inline expressions, dataframe-like output, explicit Markdown tables, matplotlib
figures, and Quarto-native static UI affordances.

## Supported behavior

- document-level `execute` defaults from Quarto's merged format execution
  options, overridden by chunk-local `#|` options for: `eval`, `echo`,
  `include`, `output`, `message`, `warning`, and `error`
- defaults when Quarto does not provide a value: `eval=true`, `echo=false`,
  `include=true`, `output=true`, `message=true`, `warning=true`, `error=false`
- `echo: fenced` tutorial output and `output: asis` raw Markdown stdout
- R/knitr-port compatibility for `message: false`, which suppresses ordinary
  stderr text, plus accepted common no-op/alias options: `results` (`asis` maps
  to raw Markdown output, `hide` maps to hidden output, `markup`/`hold` are
  accepted), `collapse`, and `comment`
- shared Python state across chunks in a single document render
- stdout/stderr text capture
- Python warnings captured as separate warning events; `warning: false`
  suppresses those warning events but does not suppress ordinary stderr text
- importable-only no-Jupyter display API:
  `from uv_python_runtime import display, display_all, Markdown, HTML, Text`
- `display_all(...)` emits several display events in order, which is useful when
  porting R chunks that showed several intermediate objects
- display events for plain text, explicit Markdown, and author-trusted raw HTML;
  raw HTML is not sanitized and is primarily validated for static HTML output
- explicit Markdown pipe tables through `display(Markdown(...))`, with
  single-table `tbl-cap` plus `tbl-*` label support for Quarto table captions and
  cross-references
- optional pandas `DataFrame`/`Series` rendering as dependency-free Markdown pipe
  tables, detected before pandas HTML or tabulate-backed Markdown fallbacks;
  `tbl-cap` plus `tbl-*` labels work for single-table chunks
- optional polars `DataFrame`/`Series` rendering as dependency-free Markdown pipe
  tables using native extraction (`to_dicts()` and `to_list()`), without pandas
  conversion; `tbl-cap` plus `tbl-*` labels work for single-table chunks
- Jupyter-like display of the final top-level expression in a chunk; assignment
  only chunks produce no expression output and full `ipynb-shell-interactivity`
  modes are not implemented
- allowed traceback rendering with `#| error: true`
- disallowed errors fail the render with runner diagnostics
- matplotlib capture with the headless `Agg` backend; PNG remains the default,
  with `fig-format: svg` also supported
- matplotlib `Figure` and `Axes` objects returned as last expressions or passed
  to `display(...)` render as static figures, improving seaborn/matplotlib ports
- optional plotnine `ggplot` objects render as static matplotlib-backed figures
  through `draw(show=False)` without Jupyter/IPython display protocols
- document/format and chunk-level `fig-width`, `fig-height`, `fig-dpi`, and
  feasible `fig-format` (`png`, `svg`, `retina` as PNG) applied to matplotlib
  defaults/savefig; chunk-level sizing is uv-python extension behavior
- single-figure `label: fig-*` plus `fig-cap` cross-references, and `fig-alt`,
  `fig-align`, `fig-link`, `width`, and `height` image metadata
- basic multiple matplotlib figures in one chunk, rendered in figure-number
  order; `fig-cap` lists must match figure count, while scalar captions apply to
  each unlabeled figure
- Quarto-style inline Python expressions in Markdown prose, evaluated in source
  order against the same shared namespace as chunks; plain inline text is escaped
  while explicit `uv_python_runtime.Markdown`/`HTML` wrappers render rich inline
  output
- uv-python-specific `params` mapping in Python globals, merging YAML `params`
  with Quarto `ExecuteOptions.params` / CLI `-P` values taking precedence
- `QUARTO_EXECUTE_INFO` points at a uv-python-written JSON file with document
  path and active format identifier/execute/render/pandoc/language/metadata;
  `QUARTO_PROJECT_DIR` is not synthesized by uv-python, but Quarto may provide it
  in the inherited render environment
- runner/renderer output protocol: `uv-python.output-events/v1` ordered by
  executable chunk; stdout and stderr are captured separately, so byte-exact
  stdout/stderr interleaving is not promised

## Human-inspection examples

The inspection examples are designed for opening the generated HTML in a browser:

```bash
./scripts/inspect.sh
```

Generated files:

- `examples/inspect/surface-no-raw-html.html` — current static product surface
  without `HTML(...)`.
- `examples/inspect/dataframes-current.html` — current dataframe-like behavior
  without pandas/polars dependencies and without raw HTML.
- `examples/inspect/matplotlib.html` — figure sizing, captions, and multi-figure
  output.
- `examples/inspect/quarto-ui-no-raw-html.html` — Quarto-native tabsets/callouts
  plus uv-python output, without Python-injected HTML.

Optional ecosystem examples are rendered by `./scripts/ecosystem.sh` under
`examples/ecosystem/` for pandas, polars, and plotnine inspection. They use
`uv-python.with` and do not add those packages to this repository's core
dependencies.

## Known limitations

The fallback scope is intentionally narrow. Deferred or out-of-scope features are
explicitly not part of this static parity slice:

- pandas Styler, MultiIndex parity beyond fallback stringification, advanced
  styling, and tabulate-backed dataframe output;
- polars LazyFrame auto-collection, pandas conversion, and advanced dtype
  formatting; polars `to_dicts()` converts to Python values and may truncate
  nanosecond temporal values to microseconds, and `Series.to_list()` copies data;
- huge dataframe pagination; the internal table formatter emits up to the
  configured display limits, defaulting to 25 rows and 12 columns and inserting
  ellipsis markers when truncating;
- exact ggplot2/tidyverse parity; plotnine support is static and optional;
- complex tables, table panels, subtables, and arbitrary HTML table processing;
- Plotly, widgets, interactive figures, arbitrary MIME bundles, and rich
  front-end state;
- Jupyter/IPython compatibility, magics, kernels, notebook execution, nbclient,
  `.ipynb` rendering, VS Code/Jupyter interactive cells, and live kernel daemons;
- mixed-engine R/Python documents and full knitr parity;
- cache/freeze parity;
- registry publishing and release automation, which require a separate plan.

Unknown chunk options and invalid supported option values fail fast rather than
being partially interpreted. Multiple table-like Markdown display events in one
`tbl-cap` chunk are rejected as ambiguous. Figure layouts/subfigures, labeled
multi-figure groups, dark/light renderings, LaTeX-specific figure
environments/positions, and interactive figures are deferred. Inline execution is
expression-only; Jupyter/Papermill-style top-level variable parameter injection is
not supported.

The runner inserts the document directory and uv project root into `sys.path`
before executing chunks so simple local imports from those locations work. It is
not a package/import-system replacement.

Tracebacks are currently raw Python tracebacks from the spike runner, so they may
include runner frames and absolute local paths.

Generated validation artifacts are not source files. `.venv/`, `.quarto/`,
rendered `examples/*.html`, and `examples/*_files/` support directories are
ignored and may be regenerated by the validation commands.

Use the cleanup helper to remove generated Quarto artifacts without deleting
source files, config, lockfiles, the extension, or examples:

```bash
./scripts/clean.sh
```

Preview cleanup first with:

```bash
./scripts/clean.sh --dry-run
```

By default this removes `.quarto/`, rendered `examples/**/*.html`,
`examples/**/*_files/`, and any `*.quarto_ipynb` files. It keeps `.venv/`; pass
`--venv` only when you explicitly want to rebuild the uv environment too:

```bash
./scripts/clean.sh --venv
```

## Examples

```bash
quarto render examples/basic.qmd
quarto render examples/error-allowed.qmd
quarto render examples/parity/figures.qmd
quarto render examples/parity/tables.qmd
quarto render examples/parity/inline-context.qmd
quarto render examples/parity/params-context.qmd
```

`examples/error-disallowed.qmd` is expected to fail because `error` defaults to
`false`. A healthy failure includes `uv-python failed`, a Python `Traceback`, and
`disallowed spike error` in the diagnostics.

Slice 3/post-spike feature work requires a dedicated plan before expanding
features beyond this spike's supported behavior.
