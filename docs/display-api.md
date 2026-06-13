# uv-python display API contract

Status: implemented for Phase 4 of Slice 3, reused by Phase 7 inline output,
validated by Phase 8 parity fixtures, and extended with optional pandas, polars,
plotnine static ecosystem rendering, and small R-lab compatibility helpers.
The current implementation provides the canonical importable-only
`uv_python_runtime` helpers, display events, object protocol fallback order,
narrow last-expression display, and explicit `Markdown`/`HTML` wrapper rendering
for inline expressions. It remains a no-Jupyter API, not an IPython
compatibility layer.

The display runtime must remain uv-native and no-Jupyter. It gives authors a
small, explicit way to request text, Markdown, and trusted HTML output without
pretending to implement `IPython.display`.

## Canonical API

The canonical import path is:

```python
from uv_python_runtime import display, display_all, Markdown, HTML, Text
```

Canonical usage:

```python
from uv_python_runtime import display, display_all, Markdown, HTML, Text

display(Text("literal **not markdown**"))
display(Markdown("**rendered as Markdown**"))
display(HTML("<strong>trusted author HTML</strong>"))
display_all(Text("first"), Markdown("**second**"))
```

`uv_python_runtime` is deliberately not named `pymd`, so it does not collide with
this repository name or any future package name. It is also deliberately not a
fake `IPython.display` module.

## Globals policy

Helpers are importable only. The runner should not inject `display`, `Markdown`,
`HTML`, or `Text` into user globals by default.

Rationale:

- explicit imports make examples reproducible as ordinary Python code;
- no injected names avoids collisions with author variables or project modules;
- the API remains visibly uv-python-specific rather than implying Jupyter or
  IPython compatibility.

A future slice may add opt-in injected helpers only after a separate contract and
validation update.

## Supported wrappers

The initial runtime module should expose these small wrappers:

- `Text(value: object)`: render as plain text using `str(value)`;
- `Markdown(markdown: str)`: render as raw Markdown;
- `HTML(html: str)`: render as author-trusted raw HTML;
- `display(value: object)`: inspect and emit the first supported representation
  according to the object protocol order below;
- `display_all(*values: object)`: emit one display event for each value in order.

Wrapper instances should be simple Python objects owned by `uv_python_runtime`.
They should not require pandas, polars, tabulate, IPython, nbformat, or an HTML
parser.

## Object protocol order

`display(value)` should choose exactly one representation in this order:

1. Explicit uv-python wrappers:
   - `Text` -> `display_text` event;
   - `Markdown` -> `display_markdown` event;
   - `HTML` -> `display_html` event, subject to author-trusted HTML policy.
2. Optional dataframe/series helpers, when their libraries are installed:
   - pandas `DataFrame` / `Series` -> one dependency-free Markdown pipe table;
   - polars `DataFrame` / `Series` -> one dependency-free Markdown pipe table.
3. Optional plotnine helper, when plotnine is installed:
   - plotnine `ggplot` -> static matplotlib `Figure` via `draw(show=False)`.
4. Matplotlib figure helpers, when matplotlib is installed:
   - `matplotlib.figure.Figure` -> static figure event;
   - `matplotlib.axes.Axes` -> its parent static figure event;
   - simple figure-like objects with a `figure` or `fig` attribute pointing at a
     matplotlib `Figure` -> static figure event.
5. `_repr_markdown_()` if present and callable -> `display_markdown` event.
6. `_repr_html_()` if present and callable -> `display_html` event only when the
   author-trusted HTML policy is enabled for the render; otherwise degrade or
   fail according to the output protocol's unsupported-display rule.
7. `to_markdown()` if present and callable -> `display_markdown` event.
8. `to_html()` if present and callable -> `display_html` event only under the
   author-trusted HTML policy.
9. `repr(value)` fallback -> `display_text` event.

Protocol caveats:

- `_repr_markdown_`, `_repr_html_`, `to_markdown`, and `to_html` must return a
  string. Non-string returns are unsupported and must fail clearly or degrade to
  `repr()` with a warning, as chosen by the implementing slice.
- `display()` should not emit multiple MIME alternatives for one object in the
  first implementation. Multi-representation bundles are out of scope.
- Last-expression display, when added, may reuse this order after first checking
  explicit wrappers. If no richer representation is found, it should fall back to
  `repr()` text.
- pandas and polars detection intentionally happens before generic HTML or
  `to_markdown()` fallbacks so dataframe output does not become raw HTML or depend
  on pandas' tabulate-backed Markdown methods.

## Trust and rendering policy

Plain text is safe by default:

- `Text(...)`, `display_text`, and `repr()` fallback are escaped or fenced;
- Markdown-looking or HTML-looking text must remain literal text.

Markdown is explicit author output:

- `Markdown(...)`, `_repr_markdown_()`, and `to_markdown()` emit raw Markdown;
- Markdown output is expected to work across formats only when the resulting
  Markdown is valid for Pandoc/Quarto.
- Phase 5 validates dependency-free Markdown pipe tables through
  `display(Markdown(...))`; `tbl-cap` plus a `tbl-*` `label` is supported only
  for a single table-like Markdown display event in a chunk.

HTML is author-trusted output:

- `HTML(...)`, `_repr_html_()`, and `to_html()` emit raw HTML only under the
  author-trusted HTML policy;
- Phase 4 enables that author-trusted policy by default for static HTML output;
- `uv-python` does not sanitize the HTML;
- non-HTML formats may not preserve it. Current cross-format validation covers
  figure artifact namespacing/link resolution in HTML+GFM, not raw HTML display
  parity in every output format.

## Import-path and collision strategy

The runner should make `uv_python_runtime` importable only for code executed by
the uv-python engine. Acceptable implementation strategies include:

- placing a small package directory beside the extension runner and prepending
  that extension path to `sys.path`; or
- creating an in-memory/module object before user execution if packaging the
  helper beside the runner proves simpler.

Whichever strategy is chosen must follow these collision rules:

- do not shadow a user project package named `uv_python_runtime` silently;
- if both a user package and the engine runtime package are importable, prefer a
  clear fail-fast diagnostic over ambiguous import behavior;
- do not use the repository name `pymd` as the runtime API;
- do not provide an `IPython` package or monkeypatch `IPython.display`.

The implementation slice must document the selected import strategy and add a
fixture proving imports resolve to the intended runtime module.

Phase 4 selected a small package directory beside the runner:
`_extensions/uv-python/uv_python_runtime/`. The runner loads that package by
absolute path into `sys.modules` so `from uv_python_runtime import ...` works
during uv-python execution. Before loading it, the runner checks the document
directory and uv project root for a top-level `uv_python_runtime` module and
fails fast rather than silently shadowing a user module.

## No-IPython-compat promise

`uv-python` should not promise IPython compatibility. Specifically out of scope:

- `from IPython.display import display, Markdown, HTML` compatibility;
- Jupyter MIME bundles or `_repr_mimebundle_`;
- display IDs, updates, `clear_output`, comms, widgets, or rich front-end state;
- shell magics, cell magics, or IPython execution semantics;
- notebook kernel lifecycle, daemon, or live editor integration.

If users need those behaviors, they should use Quarto's Jupyter engine rather
than `uv-python`.

## Dependency policy

No core dependency additions are approved by this contract.

Rules for future slices:

- no mandatory pandas dependency without explicit user approval;
- no mandatory polars dependency without explicit user approval;
- no mandatory tabulate dependency without explicit user approval;
- no mandatory HTML parser/sanitizer dependency without explicit user approval;
- no Jupyter, IPython, nbclient, ipykernel, notebook, or widget dependency;
- optional/dev fixture dependencies must be isolated, documented, and skipped or
  guarded when absent;
- optional ecosystem packages are execution-time/user-project decisions, not
  extension core dependencies.

The first table/display features should work with only the existing project
runtime dependencies. Explicit Markdown table display is the preferred first
table path because it requires no dataframe library or table-rendering package.
Pandas, polars, and plotnine are optional execution-time dependencies only. They
may be provided by the user's uv project or transient `uv-python.with` metadata;
they must not be added to this extension's core dependency set. Dataframe
rendering uses an internal Markdown pipe-table formatter and does not call
pandas `DataFrame.to_markdown()` or `Series.to_markdown()` because those require
`tabulate`.

The internal dataframe table formatter includes the index for pandas dataframes
and series, uses ordinal indexes for polars series, stringifies MultiIndex and
other complex labels, renders missing values as empty cells, replaces embedded
newlines with `<br>`, escapes Markdown-sensitive characters, and encodes literal
cell pipes as `&#124;`. It emits at most 25 rows and 12 columns by default, inserting
ellipsis markers when truncating. Documents can tune those limits with
`uv-python.dataframe.max-rows` and `uv-python.dataframe.max-cols`; both must be
integers greater than or equal to 3.

Deferred optional-ecosystem work includes pandas Styler, pandas MultiIndex parity
beyond fallback stringification, polars LazyFrame auto-collection, dataframe
styling, arbitrary HTML table processing, and interactive/widget display.

## Examples for future fixtures

Plain text remains literal:

```python
from uv_python_runtime import display, Text

display(Text("# Not a heading"))
```

Markdown is explicit:

```python
from uv_python_runtime import display, Markdown

display(Markdown("# Heading from Python"))
```

HTML is explicit and trusted:

```python
from uv_python_runtime import display, HTML

display(HTML("<span class='note'>HTML-only output</span>"))
```

Object protocol example:

```python
class Summary:
    def _repr_markdown_(self):
        return "**summary**"

display(Summary())
```

Fallback example:

```python
display({"alpha": 1})  # display_text via repr()
```
