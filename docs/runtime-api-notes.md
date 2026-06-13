# Quarto runtime API notes for `uv-python`

Status: Slice 3 baseline contract plus Phase 7/8 implementation notes. These notes record local Quarto engine API evidence and the fields now used by `uv-python` option merging, params, execution context, and parity validation.

## Local versions and sources

- Quarto: `1.9.37` (`quarto --version`)
- uv: `0.11.21` (`uv --version`)
- Installed Quarto executable: `/opt/quarto/bin/quarto`
- Local Quarto type definitions: `/opt/quarto/share/extension-build/quarto-types.d.ts`
- Local scaffold precedent: `/opt/quarto/share/create/extensions/engine/src/qstart-filesafename-qend.ejs.ts`
- Local Julia engine precedent: `/opt/quarto/share/extension-subtrees/julia-engine/src/julia-engine.ts`
- Current engine implementation: `src/uv-python.ts`

## Evidence classification

- **Type-level facts** are from `/opt/quarto/share/extension-build/quarto-types.d.ts` for Quarto 1.9.37.
- **Runtime-probed facts** are from a temporary custom engine rendered under `/tmp/opencode/uv-python-runtime-probe.*`. The probe wrote no lasting production changes; temporary probe artifacts were not added to the repository.
- **Implementation facts** are from current `uv-python` source and smoke examples.

## Type-level engine API facts

`ExecuteOptions` in local Quarto 1.9.37 includes these relevant fields:

- `target: ExecutionTarget`
- `format: Format`
- `resourceDir: string`
- `tempDir: string`
- `dependencies: boolean`
- `projectDir?: string`
- `libDir?: string`
- `cwd: string`
- `params?: Record<string, unknown>`
- `quiet?: boolean`
- `previewServer?: boolean`
- `handledLanguages: string[]`
- `project: EngineProjectContext`

`ExecutionTarget` includes:

- `source: string`
- `input: string`
- `markdown: MappedString`
- `metadata: Metadata`
- `data?: unknown`

`ExecuteResult` includes:

- required `markdown: string`
- required `supporting: string[]`
- required `filters: string[]`
- optional `metadata?: Metadata`
- optional `pandoc?: Record<string, unknown>`
- optional `includes?: PandocIncludes`
- optional `engine?: string`
- optional `engineDependencies?: Record<string, Array<unknown>>`
- optional `preserve?: Record<string, string>`
- optional `postProcess?: boolean`
- optional `resourceFiles?: string[]`

`Format` includes:

- `identifier`, with keys such as `base-format`, `target-format`, `display-name`, and `extension-name`
- `language`
- `metadata`
- `render`
- `execute`
- `pandoc`

`EngineProjectContext` includes `dir`, `isSingleFile`, optional `config`, `fileInformationCache`, `getOutputDirectory()`, and `resolveFullMarkdownForFile(...)`.

## Runtime-probed `ExecuteOptions` fields

A temporary engine rendered an HTML `.qmd` with:

- `engine: probe-engine`
- YAML `params.alpha: 0.1`
- CLI parameter `-P beta:0.2`
- HTML `fig-width: 8`, `fig-height: 6`
- document/project `execute.echo: false`, `execute.warning: false`

Observed `ExecuteOptions` keys at runtime:

```text
cwd, dependencies, format, handledLanguages, libDir, params, previewServer,
project, projectDir, quiet, resourceDir, target, tempDir
```

Observed selected values:

- `resourceDir`: `/opt/quarto/share`
- `tempDir`: `/tmp/quarto-session.../...` session temp directory
- `projectDir`: temporary probe project directory
- `libDir`: `probe_files/libs`
- `cwd`: temporary probe project directory
- `dependencies`: `true`
- `handledLanguages`: `['mermaid', 'dot']`
- `params`: `{ beta: 0.2 }`
- `project`: present as an `ExecuteOptions` key at runtime; type-level shape is `EngineProjectContext`

Important params detail:

- CLI `-P beta:0.2` appeared in `ExecuteOptions.params`.
- YAML `params.alpha: 0.1` appeared in `target.metadata.params` and `format.metadata.params`, not in `ExecuteOptions.params` for this probe.
- Later `uv-python` params support should therefore deliberately define whether the Python-facing mapping includes CLI params only, YAML params from metadata, or a merge of both. Do not assume Quarto has already resolved them into `ExecuteOptions.params`.

## Runtime-probed format fields

Observed `options.format` keys:

```text
execute, extensions, formatExtras, identifier, language, mergeAdditionalFormats,
metadata, pandoc, render, resolveFormat
```

Observed active format identifier:

```json
{
  "display-name": "HTML",
  "target-format": "html",
  "base-format": "html"
}
```

Observed selected `format.execute` values:

```json
{
  "fig-width": 8,
  "fig-height": 6,
  "fig-format": "retina",
  "fig-dpi": 96,
  "df-print": "default",
  "error": false,
  "eval": true,
  "cache": null,
  "freeze": false,
  "echo": false,
  "output": true,
  "warning": false,
  "include": true,
  "keep-md": false,
  "keep-ipynb": false,
  "ipynb": null,
  "enabled": null,
  "daemon": null,
  "daemon-restart": false,
  "debug": false,
  "ipynb-filters": [],
  "ipynb-shell-interactivity": null,
  "plotly-connected": true,
  "engine": "probe-engine"
}
```

Observed selected `format.render` values:

```json
{
  "output-ext": "html",
  "fig-align": "default",
  "keep-source": false
}
```

Observed selected `format.pandoc` values:

```json
{
  "to": "html",
  "standalone": true,
  "default-image-extension": "png"
}
```

Observed `format.metadata` included document/project metadata such as `title`, `params`, `format`, `project`, `engines`, `fig-responsive`, and `quarto-version: 1.9.37`.

## Runtime-probed target metadata

Observed `target` keys:

```text
input, markdown, metadata, source
```

Observed `target.source` and `target.input` were the absolute probe `.qmd` path. `target.metadata` contained the parsed document YAML:

```json
{
  "title": "Runtime Probe",
  "engine": "probe-engine",
  "params": { "alpha": 0.1 },
  "format": { "html": { "fig-width": 8, "fig-height": 6 } },
  "execute": { "echo": false, "warning": false }
}
```

Implementation consequence: current `src/uv-python.ts` constructs `target.metadata` with `quarto.markdownRegex.extractYaml(md.value)`, matching the local scaffold and Julia engine precedent. Phase 3 option merging reads supported merged defaults from `ExecuteOptions.format.execute`; it also validates explicit document/format execute mappings in `target.metadata` so unsupported or invalid uv-python options fail fast with clear diagnostics.

## `ExecuteResult` fields

Type-level availability in Quarto 1.9.37:

- `supporting` is required (`string[]`). Current `uv-python` returns supporting directories when figures are emitted.
- `resourceFiles` is optional (`string[]`). The runtime probe returned an empty `resourceFiles: []` and render succeeded; no non-empty copy behavior was tested.
- `metadata` is optional. The runtime probe returned metadata and the render log showed it was merged into document metadata.
- `pandoc` is optional. The runtime probe returned `pandoc.metadata` and the render log showed it was passed to Pandoc metadata.

Implementation consequence: later slices may use `metadata` and `pandoc` intentionally, but should add concrete render assertions when relying on non-empty `resourceFiles` or supporting-file copying semantics.

## Current `uv-python` use of API fields

Current implementation uses:

- `options.target.markdown` for `breakQuartoMd(...)`
- `options.cwd` plus `options.target.source` to compute absolute document path
- `options.format.execute` for Phase 3 supported document/project/format execution defaults (`eval`, `echo`, `include`, `output`, `warning`, `error`)
- `options.tempDir` for runner request/response JSON
- launch `context.dir` as uv project root
- `options.target.metadata` for Phase 3 explicit document/format execute option validation
- `options.target.metadata.params` and `options.format.metadata.params` as YAML params sources
- `options.params` as CLI/ExecuteOptions params that override YAML params in the Python `params` mapping
- `options.format.metadata["uv-python"].with` as the document/project optional
  dependency source for repeated `uv run --with <requirement>` arguments; raw
  `options.target.metadata` is not used for this metadata, so Quarto's merged
  format metadata is the single source of truth
- `options.format.identifier`, `execute`, `render`, `pandoc`, `language`, and `metadata` to write the uv-python `QUARTO_EXECUTE_INFO` JSON file
- `quarto.path.inputFilesDir(documentPath)` for support directory naming
- `ExecuteResult.supporting` to register support directories containing figures

Current implementation does not yet use:

- `options.project`
- `options.projectDir`
- `options.resourceDir`
- `options.libDir`
- `ExecuteResult.metadata`
- `ExecuteResult.pandoc`
- `ExecuteResult.resourceFiles`

## Phase 7 params/context fixture evidence

Phase 7 params/context fixtures assert:

1. YAML params populate Python `params`.
2. CLI `-P` / `ExecuteOptions.params` override YAML keys and can add new keys.
3. `params` does not inject top-level Python variables.
4. `QUARTO_EXECUTE_INFO` is set and contains `document-path` plus active format identifier, execute, render, pandoc, language, and metadata.
5. uv-python does not synthesize `QUARTO_PROJECT_DIR`; local Quarto 1.9.37 provides it in the inherited render environment.

Phase 8 validation renders `examples/parity/params-context.qmd` with YAML params and again with CLI `-P` overrides, asserting the Python `params` mapping, lack of top-level variable injection, and the `QUARTO_EXECUTE_INFO` fields listed above. Future probes may still be needed for `--execute-params` file merge edge cases beyond Quarto's `ExecuteOptions.params` exposure, project-specific `QUARTO_PROJECT_DIR` behavior across Quarto releases, or non-empty `ExecuteResult.resourceFiles` behavior before using it for assets.

## Optional dependency metadata

The optional ecosystem slice adds document/project metadata:

```yaml
uv-python:
  with:
    - pandas
    - polars
    - plotnine
```

The engine reads this only from Quarto's merged format metadata at
`options.format.metadata["uv-python"].with`. It is not a chunk option and is not
read from raw `options.target.metadata`, avoiding a second precedence path. The
value must be a YAML list; each entry must be a non-empty string and must not
begin with `-`. Invalid metadata fails before the runner process is launched.

When valid entries are present, the runner command is built as repeated uv
`--with` arguments before `python`:

```text
uv run --with pandas --with polars --with plotnine python runner.py request.json response.json
```

When no entries are present, the command remains:

```text
uv run python runner.py request.json response.json
```
