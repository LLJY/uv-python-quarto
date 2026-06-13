# uv-python output protocol contract

Status: implemented and validated for the Slice 3 static parity scope. The current runner and renderer use
`uv-python.output-events/v1` for chunk-level `stdout`, `stderr`, `warning`,
`error`, `display_text`, `display_markdown`, `display_html`, `figure`, and
`skipped` events. Phase 5 added renderer-only support for explicit Markdown pipe
tables with single-table `tbl-cap`/`tbl-*` caption and crossref metadata. Phase 6
added static matplotlib `fig-*` settings, captions/crossrefs, alt/align/link
metadata, format-namespaced artifacts, and basic ordered multi-figure rendering.
Phase 7 added inline expression events, inline escaping, inline text escaping,
uv-python `params`, and `QUARTO_EXECUTE_INFO`. Phase 8 validates the protocol with
rendered fixtures plus a direct runner event-order regression. Richer
layout/table metadata remains deferred.

The protocol below defines the ordered, versioned output event stream used by the
current implementation and reserved for future slices before adding richer
figure/table metadata.

## Goals and non-goals

Goals:

- preserve the current uv-native, no-Jupyter execution contract;
- represent every user-visible result as an ordered event;
- make chunk, inline, warning, error, display, and figure rendering explicit;
- leave enough room for inline execution without redesigning the runner again.

Non-goals:

- no IPython/Jupyter MIME bundle protocol;
- no widget, comm, kernel, notebook, or live session semantics;
- no exact stdout/stderr byte-level interleaving promise unless a later runner
  implementation proves it can provide one safely.

## Protocol version

The first event-stream protocol version is `uv-python.output-events/v1`.

Runner responses should include the protocol version once at the top level and
repeat per-event fields needed by renderers and tests:

```ts
type OutputProtocolVersion = "uv-python.output-events/v1";

type RunnerResponseV1 = {
  protocol: OutputProtocolVersion;
  events: OutputEventV1[];
  failed: boolean;
  failedChunk?: number;
  failedSequence?: number;
};
```

Python producer code should be able to build the same shape with plain dicts:

```python
response = {
    "protocol": "uv-python.output-events/v1",
    "events": [],
    "failed": False,
}
```

Protocol changes that alter event names, required fields, or rendering semantics
must use a new protocol string. Additive metadata fields may remain on v1 when
renderers can safely ignore them.

## Common event fields

All events share these fields:

```ts
type OutputEventKind =
  | "stdout"
  | "stderr"
  | "warning"
  | "error"
  | "display_text"
  | "display_markdown"
  | "display_html"
  | "figure"
  | "skipped";

type OutputEventBaseV1 = {
  protocol: "uv-python.output-events/v1";
  kind: OutputEventKind;
  sequence: number;
  chunkIndex: number;
  inlineIndex?: number;
  payload: unknown;
  metadata?: Record<string, unknown>;
};
```

Field contract:

- `protocol`: always `uv-python.output-events/v1`.
- `kind`: one of the required event kinds above.
- `sequence`: zero-based, monotonically increasing document-wide order. No two
  events in one response may share a sequence number.
- `chunkIndex`: zero-based executable chunk index for chunk events. Inline-only
  events also carry the zero-based chunk index of the most recent preceding
  executable chunk; if an inline expression appears before any chunk, use `-1`.
- `inlineIndex`: zero-based inline-expression index for events caused by inline
  execution. Omit for ordinary chunk events.
- `payload`: kind-specific event body.
- `metadata`: optional kind-specific or renderer-specific details. Unknown
  metadata keys must be ignored unless a future protocol version makes them
  required.

Prefer camelCase in JSON because the current engine is TypeScript-first on the
Quarto side. Python code may use local snake_case variables but must serialize
the documented JSON keys.

## Event kinds

### `stdout`

Text written to standard output during a chunk or inline expression.

```ts
type StdoutEventV1 = OutputEventBaseV1 & {
  kind: "stdout";
  payload: { text: string };
  metadata?: {
    stream?: "stdout";
    truncated?: boolean;
  };
};
```

Semantics:

- nonfatal;
- included or suppressed by output/rendering options, not by runner deletion;
- rendered as escaped/fenced text by default;
- may render as raw Markdown only under `output: asis` as described below.

### `stderr`

Text written to standard error that is not classified as a Python warning or
fatal runner diagnostic.

```ts
type StderrEventV1 = OutputEventBaseV1 & {
  kind: "stderr";
  payload: { text: string };
  metadata?: {
    stream?: "stderr";
    truncated?: boolean;
  };
};
```

Semantics:

- nonfatal by itself;
- rendered as escaped/fenced diagnostic text by default;
- controlled separately from implemented `warning` events;
- may be suppressed by future `output: false` or extension policy, but must not
  be silently reclassified as `warning`.

### `warning`

Python warnings captured through the warnings subsystem, not arbitrary stderr
text.

```ts
type WarningEventV1 = OutputEventBaseV1 & {
  kind: "warning";
  payload: {
    message: string;
    category?: string;
    filename?: string;
    lineno?: number;
  };
  metadata?: {
    formatted?: string;
  };
};
```

Semantics:

- nonfatal unless Python's active filters promote the warning to an exception;
- controlled by the active `warning` execution option for rendering only;
- rendered as escaped/fenced warning text unless a later renderer explicitly
  designs a richer warning block.
- captured only when Python's current warning filters decide the warning should
  be displayed. User changes to `warnings.filters` persist across chunks, and
  filters such as `warnings.filterwarnings("error")` turn later warnings into
  `error` events rather than `warning` events.
- `warning: false` suppresses emitted/rendered warning events only. It does not
  change Python's warning filters and does not suppress ordinary stderr output.

### `error`

An exception or execution failure associated with user code.

```ts
type ErrorEventV1 = OutputEventBaseV1 & {
  kind: "error";
  payload: {
    traceback: string;
    ename?: string;
    evalue?: string;
  };
  metadata?: {
    fatal: boolean;
    allowedByOption?: boolean;
  };
};
```

Semantics:

- `metadata.fatal: true` means document execution stops and the Quarto render
  fails after the response is written when possible;
- `metadata.fatal: false` means the error is allowed by an option such as
  `error: true`, is rendered, and later chunks may continue;
- tracebacks render as escaped/fenced diagnostic text. They are never raw
  Markdown or raw HTML.

### `display_text`

Explicit display text or last-expression fallback text.

```ts
type DisplayTextEventV1 = OutputEventBaseV1 & {
  kind: "display_text";
  payload: { text: string };
  metadata?: {
    source?: "display" | "last_expression" | "repr";
  };
};
```

Semantics:

- nonfatal;
- rendered as escaped/fenced text for block output;
- rendered as escaped inline text for inline output;
- never treated as Markdown, even if the text looks like Markdown or HTML.

### `display_markdown`

Author-requested Markdown display output.

```ts
type DisplayMarkdownEventV1 = OutputEventBaseV1 & {
  kind: "display_markdown";
  payload: { markdown: string };
  metadata?: {
    source?: "display" | "last_expression" | "_repr_markdown_" | "to_markdown" | "dataframe";
  };
};
```

Semantics:

- nonfatal;
- rendered as raw Markdown because the author explicitly requested Markdown
  semantics through the display API, last-expression wrapper value, or object
  protocol;
- cross-format only to the extent Pandoc/Quarto can consume the resulting
  Markdown.
- optional pandas and polars dataframe/series renderers reuse this event kind and
  emit exactly one dependency-free Markdown pipe table for each displayed object;
  they do not introduce a table-specific protocol event.

### `display_html`

Author-trusted raw HTML display output.

```ts
type DisplayHtmlEventV1 = OutputEventBaseV1 & {
  kind: "display_html";
  payload: { html: string };
  metadata?: {
    source?: "display" | "last_expression" | "_repr_html_" | "to_html";
    trusted: true;
  };
};
```

Semantics:

- nonfatal when author-trusted HTML output is enabled;
- `metadata.source: "last_expression"` is possible when the final top-level
  expression is an explicit `HTML(...)` wrapper value;
- raw HTML is never sanitized by `uv-python` in this contract;
- unsupported or disabled trusted HTML policy must either degrade to escaped
  `display_text` with a warning or fail fast with a clear diagnostic, as chosen
  by the future feature slice;
- useful primarily for HTML output. PDF, DOCX, GFM, and other non-HTML formats
  may drop, escape, or otherwise mishandle raw HTML through Pandoc/Quarto.

### `figure`

Static figure asset produced by Python execution.

```ts
type FigureEventV1 = OutputEventBaseV1 & {
  kind: "figure";
  payload: {
    path: string;
    mime: "image/png" | "image/svg+xml" | string;
  };
  metadata?: {
    figureIndex?: number;
  };
};
```

Semantics:

- nonfatal once the asset has been written successfully;
- `path` is an absolute runner path or renderer-resolvable path that the Quarto
  side converts to a document-relative link and registers as supporting output;
- open matplotlib figures are captured at chunk end in figure-number order;
- `fig-width`, `fig-height`, `fig-dpi`, and `fig-format` (`png`, `svg`, with
  Quarto's `retina` treated as PNG) are applied by the runner before each chunk;
  per-chunk values override document defaults only for that chunk's engine-owned
  matplotlib size/DPI/format settings;
- the renderer adds Quarto/Pandoc-compatible image Markdown for `fig-cap`,
  `label: fig-*`, `fig-alt`, `fig-align`, `fig-link`, `width`, and `height`;
- `fig-*` labels require `fig-cap` and currently require exactly one figure in
  the chunk so a duplicate or ambiguous identifier is not emitted;
- if `fig-cap` is a list, its length must match the number of figure events and
  captions are applied by figure order. If scalar `fig-cap` is used with multiple
  unlabeled figures, the same caption is applied predictably to each figure;
- after capture, figures are closed to prevent stale figures from leaking into
  later chunks;
- optional plotnine `ggplot` objects are drawn with `draw(show=False)` and saved
  through the same static figure event path; returned matplotlib figures are
  captured directly so they do not depend on `plt.get_fignums()` visibility;
- explicit matplotlib `Figure`/`Axes` display also uses this same static figure
  event path, with `Axes` resolved to their parent figure;
- complex computational figure layouts, `fig-subcap`, custom `layout`, dark/light
  `renderings`, LaTeX-specific `fig-pos`/`fig-env`, and interactive figures are
  deferred;
- intercepting `matplotlib.pyplot.show()` is deferred until a later design. A
  future implementation must not pretend `plt.show()` timing is supported unless
  it explicitly captures show calls as ordered events.

### `skipped`

A chunk or inline expression that intentionally did not execute.

```ts
type SkippedEventV1 = OutputEventBaseV1 & {
  kind: "skipped";
  payload: { reason: "eval_false" | "unsupported" | string };
  metadata?: {
    fatal?: false;
  };
};
```

Semantics:

- nonfatal;
- primarily for traceability and tests;
- renders nothing by default unless a future diagnostic mode requests visible
  skipped markers.

## Ordering guarantees and limitations

The runner must emit events in document execution order:

1. all events from an earlier executable unit have lower `sequence` values than
   events from a later executable unit;
2. events generated by one chunk appear before events generated by following
   inline expressions or chunks;
3. events generated by an inline expression carry an `inlineIndex` and appear at
   the inline expression's position in the document execution stream;
4. figure events for matplotlib open figures appear after text/error/display
   events caused by the same chunk because open figures are captured at chunk
   end;
5. fatal `error` events are the last user-code event unless the runner needs to
   add non-rendered diagnostics in a future protocol.

stdout/stderr limitation:

- v1 does not require byte-exact interleaving between stdout and stderr.
- A simple implementation may capture stdout and stderr separately while a chunk
  runs, then emit at most one `stdout` event followed by at most one `stderr`
  event for that chunk.
- If a later implementation captures writes through proxy streams and can prove
  call-level ordering, it may emit multiple `stdout`/`stderr` events in observed
  write order under the same v1 schema.
- Tests must assert the documented guarantee actually implemented by the runner,
  not assume stronger interleaving than the runner provides.

## Renderer rules

### Text escaping and fencing

Block text from `stdout`, `stderr`, `warning`, `error`, and `display_text` is
escaped by containment rather than by inline character rewriting: render it in a
Pandoc fenced code block with a `.text` class and a `uv-python-*` class.

The renderer must choose a fence length longer than any run of backticks inside
the payload, matching the current spike's defensive fencing style. Plain text is
never allowed to become Markdown headings, links, raw HTML, directives, or
attributes accidentally.

Inline text results are rendered as Markdown-escaped text, not fenced blocks,
because inline output must remain in prose. At minimum, inline escaping must
protect backticks, brackets, angle brackets, ampersands, asterisks, underscores,
and other Markdown-significant characters that could change document structure.

### Raw Markdown

Raw Markdown can enter the document only from:

- `display_markdown` events; or
- `stdout` events when the renderer has explicitly selected
  `output: asis` for the producing chunk.

`output: asis` means stdout is inserted as Markdown without the normal output
container or text fence. It does not make stderr, warnings, tracebacks, or plain
`display_text` raw. Explicit `display_markdown` is raw Markdown regardless of
`output: asis` because the author requested Markdown through the display API.

When a chunk has `tbl-cap`, the renderer requires exactly one Markdown pipe table
across the chunk's `display_markdown` events and appends Pandoc table caption
syntax after that table. The captioned display payload must contain only the pipe
table block plus optional surrounding whitespace; leading/trailing prose or extra
Markdown in the same display event fails fast so Pandoc cannot silently detach the
caption from the table. If a `label` option starts with `tbl-`, it is added as
`{#tbl-*}` so Quarto table cross-references such as `@tbl-*` resolve. Zero or
multiple table-like Markdown displays in one captioned chunk are rejected as
ambiguous.

### Author-trusted raw HTML

`display_html` is raw, author-trusted HTML. The policy is:

- `uv-python` does not sanitize raw HTML;
- raw HTML is accepted only from explicit `HTML(...)`, `_repr_html_`, or
  `to_html` display paths under the display API contract. Phase 4 enables this
  author-trusted policy by default for static HTML output;
- plain stdout and `display_text` are never upgraded to raw HTML;
- non-HTML output formats may degrade or omit raw HTML according to
  Pandoc/Quarto behavior. Future validation must document the exact behavior for
  each supported format.

### Tracebacks and errors

Tracebacks render as diagnostic text fences with a distinct class such as
`.uv-python-error`. Even with `output: asis`, tracebacks are not raw Markdown or
HTML. Fatal errors should fail the render after preserving enough diagnostics for
the user to identify the failing chunk.

### Unsupported event or display behavior

Unsupported known events must fail fast during development until a deliberate
degradation rule is added. Unknown event kinds for the active protocol are a
contract violation and should produce a clear engine error.

For unsupported display content in a future display API, the implementation must
choose one documented behavior per case:

- degrade to `display_text` using `repr()` and optionally emit `warning`; or
- fail fast with an `error` event or engine diagnostic.

Silent dropping is allowed only for `skipped` events and only because their
default renderer is intentionally empty.

## Ordered document execution stream

Inline support requires the engine to parse the document into an ordered stream
before calling the runner. The stream has these item kinds:

```ts
type ExecutionStreamItemV1 =
  | { kind: "markdown_segment"; markdown: string }
  | { kind: "executable_chunk"; chunkIndex: number; code: string; options: Record<string, unknown> }
  | { kind: "inline_expression"; inlineIndex: number; code: string; engine: "python" }
  | { kind: "non_executable_block"; markdown: string; reason: string }
  | { kind: "escaped_inline_syntax"; markdown: string };
```

Rules:

- `markdown_segment` is passed through unchanged and does not execute.
- `executable_chunk` executes in source order and can update shared state.
- `inline_expression` executes exactly where it appears in prose, using shared
  state from preceding chunks and inline expressions.
- `non_executable_block` preserves code fences or blocks that are not claimed by
  `uv-python`, including ordinary examples and unsupported languages.
- `escaped_inline_syntax` preserves literal inline examples and does not execute.
- Inline code inside YAML front matter is not executable.
- Inline expressions are Python `eval` expressions; inline exceptions are fatal
  render failures in the current implementation.
- Inline plain-text fallback uses `str(value)` and escapes Markdown/HTML
  significant characters. Explicit `uv_python_runtime.Markdown` and `HTML`
  wrapper values render raw inline Markdown/HTML by author request.

Example:

````markdown
```{python}
x = 1
```

First inline sees `{python} x`.

```{python}
x = x + 10
```

Second inline sees `{python} x`.

Literal example: `{{python}} x`.
````

Required execution order:

1. first chunk sets `x = 1`;
2. first inline expression renders `1`;
3. second chunk updates `x` to `11`;
4. second inline expression renders `11`;
5. escaped inline syntax renders literally and does not execute.

The corresponding output events must have sequences that reflect that order.
Inline result events carry `inlineIndex`; chunk events omit it.
