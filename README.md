# uv-python Quarto engine

My prof made me learn R. I said no. So here you go.

This repository contains a uv-native Quarto engine extension named `uv-python`.
It renders Python-powered `.qmd` documents without Jupyter kernel, `nbclient`,
or notebook execution nonsense. It is for static Quarto documents that want
normal Python execution through `uv run`, not a fake notebook stack.

Documents opt in explicitly with:

```yaml
engine: uv-python
```

Ordinary Quarto documents that omit `engine: uv-python` are intentionally not
auto-claimed, even if they contain `{python}` chunks.

The engine executes fenced `{python}` chunks from the uv project root:

```bash
uv run python <runnerAbs> <requestAbs> <responseAbs>
```

Documents can request optional, transient render dependencies with
`uv-python.with`; those become repeated `uv run --with` flags before the runner
command. Without that metadata, the default command above is unchanged.

The runner keeps one shared global namespace for the document, captures stdout,
stderr, warnings, tracebacks, tables, and static figures, then returns a
versioned ordered event stream for Quarto to render as Markdown and image links.
It does not use Jupyter, kernels, IPython, notebooks, or `nbclient`.

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

## Install it in a Quarto project

Prerequisites:

- [Quarto](https://quarto.org/) installed and on `PATH`.
- [uv](https://docs.astral.sh/uv/) installed and on `PATH`.
- A uv project root for your document. For a new throwaway project:

```bash
mkdir uv-python-demo
cd uv-python-demo
uv init --bare
```

Install the public extension from GitHub:

```bash
quarto add LLJY/uv-python-quarto
```

That creates an `_extensions/uv-python/` directory in your project. Quarto only
installs the packaged extension contents; this repository's README, docs,
scripts, and examples above `_extensions/` are development materials.

## Run your first document

Create `report.qmd`:

````markdown
---
title: "uv-python demo"
engine: uv-python
format: html
execute:
  echo: false
uv-python:
  with:
    - pandas
    - plotnine
  dataframe:
    max-rows: 20
    max-cols: 10
---

This document is running Python through uv, not Jupyter.

```{python}
import pandas as pd

df = pd.DataFrame({"x": [1, 2, 3], "y": [1, 4, 9]})
df
```

```{python}
#| label: fig-demo
#| fig-cap: A plotnine figure rendered by uv-python
from plotnine import aes, geom_point, ggplot, labs

ggplot(df, aes("x", "y")) + geom_point() + labs(title="No kernel required")
```

The largest value is `{python} int(df["y"].max())`. See @fig-demo.
````

Render it:

```bash
quarto render report.qmd
```

Open the result:

```bash
xdg-open report.html
```

On macOS use `open report.html`; on Windows open the file from Explorer or your
browser.

## Dependency choices

The extension itself keeps the core dependency surface small. For one-off
documents, use transient dependencies:

```yaml
uv-python:
  with:
    - pandas
    - polars
    - plotnine
```

Those render as:

```bash
uv run --with pandas --with polars --with plotnine python <runnerAbs> <requestAbs> <responseAbs>
```

For persistent dependencies in your own project, add them normally and omit
`uv-python.with` if you want:

```bash
uv add pandas polars plotnine
```

`uv-python.with` is read from Quarto's merged format metadata at
`options.format.metadata["uv-python"].with`. It must be a list of non-empty
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

## Local development in this repository

For local development in this repository, render after rebuilding the TypeScript
extension:

```bash
quarto call build-ts-extension
quarto render examples/basic.qmd
```

## License

GPLv2. See `LICENSE`.

The license file was fetched from the GNU project rather than handwritten.

## Validation

Run these from the repository root:

```bash
./scripts/smoke.sh      # fast build + no-Jupyter boundary + basic render checks
./scripts/parity.sh     # documented static engine contract and expected failures
./scripts/ecosystem.sh  # optional pandas/polars/plotnine + uv-python.with checks
./scripts/inspect.sh    # browser-inspection examples
```

All scripts fail fast and change to the project root themselves, so invoking them
by absolute path is fine.

“Parity” here means **the documented static Quarto contract for this engine**,
not byte-for-byte Jupyter, knitr, tidyverse, or ggplot2 parity. The parity script
asserts:

- execution options and expected invalid-option failures;
- ordered stdout/stderr/warning/error/display events;
- display API, last-expression output, inline expressions, params, and
  `QUARTO_EXECUTE_INFO`;
- Markdown tables, dataframe tables, matplotlib/plotnine figures, captions, and
  cross-references;
- no-Jupyter dependency boundaries and generated artifact links.

`ecosystem.sh` is the optional-dependency guardrail: it renders pandas, polars,
and plotnine fixtures through `uv-python.with` and verifies those packages do not
enter core `pyproject.toml` / `uv.lock` dependencies.

## Supported behavior

### Execution

- Explicit opt-in with `engine: uv-python`; ordinary `{python}` chunks are not
  auto-claimed.
- One shared Python namespace across chunks and inline expressions.
- Supported execution options: `eval`, `echo`, `include`, `output`, `message`,
  `warning`, and `error`; defaults are `eval/include/output/message/warning=true`
  and `echo/error=false`.
- Compatibility options for R/knitr ports: `message: false`, `results`,
  `collapse`, and `comment`.
- `#| error: true` renders tracebacks; otherwise errors fail the render.

### Display and tables

- Final top-level expression display for chunks; assignment-only chunks are quiet.
- Runtime API: `display`, `display_all`, `Markdown`, `HTML`, and `Text` from
  `uv_python_runtime`.
- Plain text, explicit Markdown, and author-trusted raw HTML display.
- Markdown pipe tables with `tbl-cap` / `tbl-*` captions and cross-references.
- Optional pandas and polars DataFrame/Series rendering as dependency-free
  Markdown tables, with configurable row/column limits.

### Figures

- Static matplotlib figures through the headless `Agg` backend; PNG default, SVG
  supported.
- Matplotlib `Figure`/`Axes` last expressions and `display(...)` values render as
  figures.
- Optional plotnine `ggplot` objects render via `draw(show=False)`.
- Figure captions/crossrefs through `label: fig-*` plus `fig-cap`; basic
  multi-figure chunks are supported.

### Context and protocol

- Inline `{python}` expressions share the chunk namespace and escape plain text.
- `params` is available in Python globals, including CLI `-P` overrides.
- `QUARTO_EXECUTE_INFO` points to a uv-python JSON context file.
- Output protocol is `uv-python.output-events/v1`; event order is preserved, but
  byte-exact stdout/stderr interleaving is not promised.

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
- executing R/knitr chunks in mixed R/Python documents and full knitr parity;
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

Generated validation artifacts are not source files. `.venv/`, `.quarto/`, and
rendered `examples/**/*.html` / `examples/**/*_files/` support directories are
ignored and may be regenerated by the validation commands. Rendered outputs in
other directories are not ignored unless you add project-specific rules.

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
