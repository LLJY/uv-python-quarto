/*
 * uv-python.ts
 *
 * Minimal uv-backed Python engine extension for the Quarto spike.
 */

import { basename, dirname, fromFileUrl, join, relative, resolve } from "path";

import type {
  DependenciesOptions,
  EngineProjectContext,
  ExecuteOptions,
  ExecuteResult,
  ExecutionEngineDiscovery,
  ExecutionEngineInstance,
  ExecutionTarget,
  MappedString,
  PostProcessOptions,
  QuartoAPI,
  QuartoMdCell,
} from "@quarto/types";

let quarto: QuartoAPI;

const kEngineName = "uv-python";
const kCellLanguage = "python";
const kOutputProtocolVersion = "uv-python.output-events/v1";
const kInlineExecutionSentinel = [
  "",
  "```{python}",
  "#| include: false",
  "#| eval: false",
  "# uv-python inline-only execution sentinel",
  "```",
  "",
].join("\n");
const extensionDir = dirname(fromFileUrl(import.meta.url));

type ExecutionOptions = {
  eval: boolean;
  echo: boolean | "fenced";
  include: boolean;
  output: boolean | "asis";
  warning: boolean;
  error: boolean;
};

type FigureFormat = "png" | "svg";

type FigureSettings = {
  width?: number;
  height?: number;
  dpi?: number;
  format: FigureFormat;
};

type FigureOptions = FigureSettings & {
  label?: string;
  caption?: string | string[];
  alt?: string;
  align?: "default" | "left" | "right" | "center";
  link?: string;
  attrWidth?: string;
  attrHeight?: string;
};

type TableOptions = {
  label?: string;
  caption?: string;
};

type ParsedChunk = {
  code: string;
  options: ExecutionOptions;
  table: TableOptions;
  figure: FigureOptions;
  echoFencedOptionLines: string[];
};

type RunnerChunk = {
  index: number;
  code: string;
  options: ExecutionOptions;
  figure: FigureSettings;
};

type RunnerExecutionItem =
  | { kind: "chunk"; chunkIndex: number }
  | {
    kind: "inline";
    inlineIndex: number;
    chunkIndex: number;
    code: string;
    options: ExecutionOptions;
  };

type RunnerFigure = {
  path: string;
  mime?: string;
  index: number;
};

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

type RunnerOutputEvent = {
  protocol: typeof kOutputProtocolVersion;
  kind: OutputEventKind;
  sequence: number;
  chunkIndex: number;
  inlineIndex?: number;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type RunnerResponse = {
  protocol: typeof kOutputProtocolVersion;
  events: RunnerOutputEvent[];
  failed?: boolean;
  failedChunk?: number;
  failedInline?: number;
  failedSequence?: number;
};

type ChunkEvents = {
  events: RunnerOutputEvent[];
  figures: RunnerFigure[];
};

type InlineMarkdownSegment =
  | { kind: "text"; markdown: string }
  | { kind: "inline"; inlineIndex: number };

type ParsedMarkdownCell = {
  segments: InlineMarkdownSegment[];
};

type MarkdownPipeTableBlock = {
  startLine: number;
  endLine: number;
};

const optionKeys = ["eval", "echo", "include", "output", "warning", "error"] as const;
const tableOptionKeys = ["label", "tbl-cap"] as const;
const figureOptionKeys = [
  "label",
  "fig-width",
  "fig-height",
  "fig-dpi",
  "fig-format",
  "fig-cap",
  "fig-alt",
  "fig-align",
  "fig-link",
  "width",
  "height",
] as const;
const documentFigureOptionKeys = ["fig-width", "fig-height", "fig-dpi", "fig-format"] as const;

const optionSummary = "eval (true/false), echo (true/false/fenced), include (true/false), output (true/false/asis), warning (true/false), error (true/false)";
const documentOptionSummary = `${optionSummary}, fig-width (number), fig-height (number), fig-dpi (number), fig-format (png/svg/retina)`;
const figureOptionSummary = "label (tbl-* table labels or fig-* figure labels), tbl-cap (string), fig-width (number), fig-height (number), fig-dpi (number), fig-format (png/svg/retina), fig-cap (string or string list), fig-alt (string), fig-align (default/left/right/center), fig-link (string), width (string/number), height (string/number)";
const chunkOptionSummary = `${optionSummary}, ${figureOptionSummary}`;

const defaultExecutionOptions = (): ExecutionOptions => ({
  eval: true,
  echo: false,
  include: true,
  output: true,
  warning: true,
  error: false,
});

const defaultFigureSettings = (): FigureSettings => ({
  format: "png",
});

const uvPythonEngineDiscovery: ExecutionEngineDiscovery = {
  init: (quartoAPI: QuartoAPI) => {
    quarto = quartoAPI;
  },

  name: kEngineName,
  defaultExt: ".qmd",
  defaultYaml: () => [`engine: ${kEngineName}`],
  defaultContent: () => [
    "```{" + kCellLanguage + "}",
    "print('Hello from uv-python!')",
    "```",
  ],
  validExtensions: () => [],

  claimsFile: (_file: string, _ext: string) => false,

  claimsLanguage: (_language: string, _firstClass?: string): boolean | number => {
    // The spike is explicit opt-in only (`engine: uv-python`). Returning false
    // prevents ordinary `{python}` documents from being auto-claimed by this
    // extension when they do not select the engine in YAML.
    return false;
  },

  canFreeze: false,
  generatesFigures: true,

  launch: (context: EngineProjectContext): ExecutionEngineInstance => {
    return {
      name: uvPythonEngineDiscovery.name,
      canFreeze: uvPythonEngineDiscovery.canFreeze,

      async markdownForFile(file: string): Promise<MappedString> {
        return await markdownForFileWithInlineSentinel(file);
      },

      target: async (file: string, _quiet?: boolean, markdown?: MappedString) => {
        const md = markdown ?? await markdownForFileWithInlineSentinel(file);
        const target: ExecutionTarget = {
          source: file,
          input: file,
          markdown: md,
          metadata: quarto.markdownRegex.extractYaml(md.value),
        };
        return Promise.resolve(target);
      },

      partitionedMarkdown: async (file: string) => {
        return quarto.markdownRegex.partition(
          (await markdownForFileWithInlineSentinel(file)).value,
        );
      },

      execute: async (options: ExecuteOptions): Promise<ExecuteResult> => {
        const chunks = await quarto.markdownRegex.breakQuartoMd(
          options.target.markdown,
        );
        const documentPath = resolve(options.cwd, options.target.source);
        const documentCwd = dirname(documentPath);
        const projectRoot = resolve(context.dir);
        const supportDirName = quarto.path.inputFilesDir(documentPath);
        const supportDir = join(documentCwd, supportDirName);
        const engineFigureRoot = join(supportDir, kEngineName);
        const figureDir = join(engineFigureRoot, figureArtifactFormatNamespace(options));

        const documentOptions = documentExecutionOptions(options);
        const documentFigure = documentFigureSettings(options);
        const runnerChunks: RunnerChunk[] = [];
        const runnerItems: RunnerExecutionItem[] = [];
        const cellChunkNumbers = new Map<QuartoMdCell, number>();
        const parsedChunks = new Map<QuartoMdCell, ParsedChunk>();
        const parsedMarkdownCells = new Map<QuartoMdCell, ParsedMarkdownCell>();
        const inlineOptions = new Map<number, ExecutionOptions>();
        let previousChunkIndex = -1;
        for (const cell of chunks.cells) {
          if (isPythonCell(cell)) {
            const chunkNumber = runnerChunks.length;
            cellChunkNumbers.set(cell, chunkNumber);
            const parsed = parseChunk(cell, documentOptions, documentFigure);
            parsedChunks.set(cell, parsed);
            runnerChunks.push({
              index: chunkNumber,
              code: parsed.code,
              options: parsed.options,
              figure: figureSettingsForRunner(parsed.figure),
            });
            runnerItems.push({ kind: "chunk", chunkIndex: chunkNumber });
            previousChunkIndex = chunkNumber;
          } else if (isMarkdownCell(cell)) {
            parsedMarkdownCells.set(
              cell,
              parseMarkdownCellInlineExpressions(cell.sourceVerbatim.value, (code) => {
                const inlineIndex = inlineOptions.size;
                const options = { ...documentOptions, error: false };
                inlineOptions.set(inlineIndex, options);
                runnerItems.push({
                  kind: "inline",
                  inlineIndex,
                  chunkIndex: previousChunkIndex,
                  code,
                  options,
                });
                return inlineIndex;
              }),
            );
          }
        }

        let runnerResponse: RunnerResponse = {
          protocol: kOutputProtocolVersion,
          events: [],
        };
        if (runnerItems.length > 0) {
          if (runnerChunks.length > 0) {
            await clearActiveFigureDir(figureDir, engineFigureRoot, supportDir);
          }
          runnerResponse = await runPythonRunner({
            chunks: runnerChunks,
            items: runnerItems,
            documentPath,
            documentCwd,
            projectRoot,
            figureDir,
            tempDir: options.tempDir,
            params: pythonParams(options),
            executeInfo: quartoExecuteInfo(options, documentPath),
          });
        }

        const eventsByChunk = new Map<number, ChunkEvents>();
        const eventsByInline = new Map<number, RunnerOutputEvent[]>();
        for (const event of runnerResponse.events) {
          if (event.inlineIndex !== undefined) {
            let inlineEvents = eventsByInline.get(event.inlineIndex);
            if (inlineEvents === undefined) {
              inlineEvents = [];
              eventsByInline.set(event.inlineIndex, inlineEvents);
            }
            inlineEvents.push(event);
            continue;
          }
          let chunkEvents = eventsByChunk.get(event.chunkIndex);
          if (chunkEvents === undefined) {
            chunkEvents = { events: [], figures: [] };
            eventsByChunk.set(event.chunkIndex, chunkEvents);
          }
          chunkEvents.events.push(event);
          if (event.kind === "figure") {
            const path = stringPayloadField(event, "path");
            chunkEvents.figures.push({
              path,
              mime: stringPayloadField(event, "mime", false),
              index: numericMetadataField(event, "figureIndex") ?? chunkEvents.figures.length,
            });
          }
        }

        const processedCells: string[] = [];
        const supporting = new Set<string>();
        for (const cell of chunks.cells) {
          if (isMarkdownCell(cell)) {
            const parsedMarkdown = parsedMarkdownCells.get(cell);
            processedCells.push(
              parsedMarkdown === undefined
                ? cell.sourceVerbatim.value
                : renderMarkdownCellWithInline(parsedMarkdown, eventsByInline, inlineOptions),
            );
            continue;
          }
          if (!isPythonCell(cell)) {
            processedCells.push(cell.sourceVerbatim.value);
            continue;
          }
          const chunkNumber = cellChunkNumbers.get(cell);
          if (chunkNumber === undefined) {
            processedCells.push(cell.sourceVerbatim.value);
            continue;
          }
          const parsed = parsedChunks.get(cell);
          if (parsed === undefined) {
            throw new Error(`uv-python internal error: missing parsed chunk ${chunkNumber}.`);
          }
          const output = eventsByChunk.get(chunkNumber);
          processedCells.push(
            renderChunkMarkdown(parsed, output, documentCwd),
          );
          if (output?.figures.length) {
            supporting.add(supportDir);
          }
        }

        return {
          engine: kEngineName,
          markdown: processedCells.join(""),
          supporting: Array.from(supporting),
          filters: [],
        };
      },

      dependencies: (_options: DependenciesOptions) => {
        return Promise.resolve({ includes: {} });
      },

      postprocess: (_options: PostProcessOptions) => Promise.resolve(),
    };
  },
};

export default uvPythonEngineDiscovery;

async function markdownForFileWithInlineSentinel(file: string): Promise<MappedString> {
  const original = Deno.readTextFileSync(file);
  const markdown = await markdownWithInlineExecutionSentinel(original);
  if (markdown === original) {
    return quarto.mappedString.fromFile(file);
  }
  return quarto.mappedString.fromString(markdown, file);
}

async function markdownWithInlineExecutionSentinel(markdown: string): Promise<string> {
  if (!hasExecutableInlineExpression(markdown)) {
    return markdown;
  }
  const chunks = await quarto.markdownRegex.breakQuartoMd(markdown);
  if (chunks.cells.some((cell) => isPythonCell(cell))) {
    return markdown;
  }
  return `${markdown.replace(/[ \t]*$/, "")}${kInlineExecutionSentinel}`;
}

function isPythonCell(cell: QuartoMdCell): boolean {
  return typeof cell.cell_type === "object" &&
    cell.cell_type.language.toLowerCase() === kCellLanguage;
}

function isMarkdownCell(cell: QuartoMdCell): boolean {
  return cell.cell_type === "markdown";
}

function parseMarkdownCellInlineExpressions(
  markdown: string,
  allocateInline: (code: string) => number,
): ParsedMarkdownCell {
  const frontMatter = frontMatterRange(markdown);
  if (frontMatter === undefined) {
    return { segments: parseInlineSegments(markdown, allocateInline) };
  }

  const before = markdown.slice(0, frontMatter.end);
  const after = markdown.slice(frontMatter.end);
  return {
    segments: [
      ...(before ? [{ kind: "text" as const, markdown: before }] : []),
      ...parseInlineSegments(after, allocateInline),
    ],
  };
}

function frontMatterRange(markdown: string): { end: number } | undefined {
  if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) {
    return undefined;
  }
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
  return match === null ? undefined : { end: match[0].length };
}

function parseInlineSegments(
  markdown: string,
  allocateInline: (code: string) => number,
): InlineMarkdownSegment[] {
  const segments: InlineMarkdownSegment[] = [];
  let position = 0;
  let fence: { marker: "`" | "~"; length: number } | undefined;
  const listContexts: MarkdownListContext[] = [];
  while (position < markdown.length) {
    const lineEnd = markdown.indexOf("\n", position);
    const nextPosition = lineEnd === -1 ? markdown.length : lineEnd + 1;
    const line = markdown.slice(position, nextPosition);
    const lineWithoutNewline = line.replace(/\r?\n$/, "");
    const lineStartsListItem = markdownListMarkerStart(lineWithoutNewline) !== undefined;
    const listContext = currentMarkdownListContextForLine(lineWithoutNewline, listContexts);
    const explicitContainerContentLine = stripMarkdownContainerPrefixes(lineWithoutNewline);
    const containerContentLine = lineStartsListItem
      ? explicitContainerContentLine
      : stripListContinuationIndent(explicitContainerContentLine, listContext);

    if (fence !== undefined) {
      pushTextSegment(segments, line);
      if (closesMarkdownFence(containerContentLine, fence)) {
        fence = undefined;
      }
      position = nextPosition;
      continue;
    }

    const openingFence = markdownFenceStart(containerContentLine);
    if (openingFence !== undefined) {
      fence = openingFence;
      pushTextSegment(segments, line);
      position = nextPosition;
      continue;
    }

    if (isIndentedCodeLine(containerContentLine)) {
      pushTextSegment(segments, line);
      position = nextPosition;
      continue;
    }

    parseInlineCodeSpanSegments(line, allocateInline, segments);
    position = nextPosition;
  }
  return segments;
}

function parseInlineCodeSpanSegments(
  markdown: string,
  allocateInline: (code: string) => number,
  segments: InlineMarkdownSegment[],
): void {
  let position = 0;
  while (position < markdown.length) {
    const tickStart = markdown.indexOf("`", position);
    if (tickStart === -1) {
      pushTextSegment(segments, markdown.slice(position));
      return;
    }

    const tickEnd = endOfRun(markdown, tickStart, "`");
    const tickCount = tickEnd - tickStart;
    const fence = "`".repeat(tickCount);
    const closing = markdown.indexOf(fence, tickEnd);
    if (closing === -1) {
      pushTextSegment(segments, markdown.slice(position));
      return;
    }

    if (tickCount !== 1) {
      pushTextSegment(segments, markdown.slice(position, closing + tickCount));
      position = closing + tickCount;
      continue;
    }

    const content = markdown.slice(tickEnd, closing);
    if (content.startsWith("{python}") && !content.startsWith("{{python}}")) {
      const code = content.slice("{python}".length).trim();
      if (code.length === 0) {
        throw new Error("uv-python inline expression cannot be empty.");
      }
      pushTextSegment(segments, markdown.slice(position, tickStart));
      segments.push({ kind: "inline", inlineIndex: allocateInline(code) });
    } else {
      pushTextSegment(segments, markdown.slice(position, closing + 1));
    }
    position = closing + 1;
  }
}

function hasExecutableInlineExpression(markdown: string): boolean {
  let found = false;
  parseMarkdownCellInlineExpressions(markdown, (_code) => {
    found = true;
    return 0;
  });
  return found;
}

function markdownFenceStart(line: string): { marker: "`" | "~"; length: number } | undefined {
  const match = line.match(/^(?: {0,3})(`{3,}|~{3,})/);
  if (match === null) {
    return undefined;
  }
  return { marker: match[1][0] as "`" | "~", length: match[1].length };
}

function closesMarkdownFence(
  line: string,
  fence: { marker: "`" | "~"; length: number },
): boolean {
  const match = line.match(/^(?: {0,3})(`+|~+)[ \t]*$/);
  return match !== null && match[1][0] === fence.marker && match[1].length >= fence.length;
}

function stripMarkdownContainerPrefixes(line: string): string {
  let rest = line;
  let strippedAny = false;
  while (true) {
    const blockquote = rest.match(/^(?: {0,3})>[ \t]?/);
    if (blockquote !== null) {
      rest = rest.slice(blockquote[0].length);
      strippedAny = true;
      continue;
    }

    const list = rest.match(/^((?: {0,3})(?:[-+*]|\d{1,9}[.)]))([ \t]*|$)/);
    if (list !== null) {
      const padding = list[2] ?? "";
      rest = rest.slice(list[1].length + (padding.length > 0 ? 1 : 0));
      strippedAny = true;
      continue;
    }

    break;
  }
  return strippedAny ? rest : line;
}

type MarkdownListContext = {
  markerIndent: number;
  contentIndent: number;
};

function currentMarkdownListContextForLine(
  line: string,
  contexts: MarkdownListContext[],
): MarkdownListContext | undefined {
  if (/^[ \t]*$/.test(line)) {
    return contexts[contexts.length - 1];
  }

  const marker = markdownListMarkerStart(line);
  if (marker !== undefined) {
    while (contexts.length > 0 && marker.markerIndent < contexts[contexts.length - 1].contentIndent) {
      contexts.pop();
    }
    contexts.push(marker);
    return marker;
  }

  const indent = leadingSpaceCount(line);
  while (contexts.length > 0 && indent < contexts[contexts.length - 1].contentIndent) {
    contexts.pop();
  }
  return contexts[contexts.length - 1];
}

function markdownListMarkerStart(line: string): MarkdownListContext | undefined {
  const match = line.match(/^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+|$)/);
  if (match === null) {
    return undefined;
  }

  const markerIndent = match[1].length;
  const markerEnd = markerIndent + match[2].length;
  const padding = match[3] ?? "";
  const paddingWidth = leadingIndentWidth(padding, markerEnd);
  // CommonMark treats one post-marker space as the list content indent when
  // the marker is followed by more than four spaces. The remaining spaces are
  // part of the item content, so `-     code` is list-contained indented code.
  const contentIndent = paddingWidth > 4 ? markerEnd + 1 : markerEnd + paddingWidth;
  return { markerIndent, contentIndent };
}

function stripListContinuationIndent(line: string, context: MarkdownListContext | undefined): string {
  if (context === undefined) {
    return line;
  }

  let index = 0;
  while (index < context.contentIndent && index < line.length && line[index] === " ") {
    index += 1;
  }
  return line.slice(index);
}

function leadingSpaceCount(line: string): number {
  const match = line.match(/^ */);
  return match === null ? 0 : match[0].length;
}

function leadingIndentWidth(indentation: string, startColumn: number): number {
  let column = startColumn;
  for (const character of indentation) {
    if (character === "\t") {
      column += 4 - (column % 4);
    } else {
      column += 1;
    }
  }
  return column - startColumn;
}

function isIndentedCodeLine(line: string): boolean {
  return /^(?: {4}|\t)/.test(line);
}

function endOfRun(markdown: string, start: number, marker: string): number {
  let end = start + 1;
  while (end < markdown.length && markdown[end] === marker) {
    end += 1;
  }
  return end;
}

function pushTextSegment(segments: InlineMarkdownSegment[], markdown: string): void {
  if (!markdown) {
    return;
  }
  const previous = segments[segments.length - 1];
  if (previous?.kind === "text") {
    previous.markdown += markdown;
    return;
  }
  segments.push({ kind: "text", markdown });
}

function documentExecutionOptions(options: ExecuteOptions): ExecutionOptions {
  const merged = defaultExecutionOptions();
  validateExplicitExecuteDefaults(options.target.metadata, options.format.identifier?.["target-format"]);

  const formatExecute = objectRecord(options.format.execute);
  if (formatExecute !== undefined) {
    for (const key of optionKeys) {
      if (key in formatExecute) {
        merged[key] = parseOptionValue(key, formatExecute[key]);
      }
    }
  }

  return merged;
}

function documentFigureSettings(options: ExecuteOptions): FigureSettings {
  const merged = defaultFigureSettings();
  const formatExecute = objectRecord(options.format.execute);
  if (formatExecute !== undefined) {
    for (const key of documentFigureOptionKeys) {
      if (key in formatExecute) {
        applyFigureSetting(merged, key, formatExecute[key]);
      }
    }
  }
  return merged;
}

function validateExplicitExecuteDefaults(
  metadata: unknown,
  targetFormat: unknown,
): void {
  const root = objectRecord(metadata);
  if (root === undefined) {
    return;
  }
  validateExecuteObject(root.execute, "document-level execute");

  const format = objectRecord(root.format);
  if (format === undefined) {
    return;
  }
  const activeFormat = typeof targetFormat === "string" ? targetFormat : undefined;
  const formatNames = activeFormat !== undefined ? [activeFormat] : Object.keys(format);
  for (const name of formatNames) {
    const formatOptions = objectRecord(format[name]);
    if (formatOptions !== undefined && "execute" in formatOptions) {
      validateExecuteObject(formatOptions.execute, `format '${name}' execute`);
    }
  }
}

function validateExecuteObject(value: unknown, sourceName: string): void {
  if (value === undefined) {
    return;
  }
  const execute = objectRecord(value);
  if (execute === undefined) {
    throw new Error(`uv-python ${sourceName} must be a YAML mapping.`);
  }
  for (const key of Object.keys(execute)) {
    if (!isSupportedOptionKey(key)) {
      if (isDocumentFigureOptionKey(key)) {
        applyFigureSetting(defaultFigureSettings(), key, execute[key]);
        continue;
      }
      throw new Error(
        `Unsupported uv-python ${sourceName} option '${key}'. Supported options: ${documentOptionSummary}.`,
      );
    }
    parseOptionValue(key, execute[key]);
  }
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function parseChunk(
  cell: QuartoMdCell,
  documentOptions: ExecutionOptions,
  documentFigure: FigureSettings,
): ParsedChunk {
  const options = { ...documentOptions };
  const table: TableOptions = {};
  const figure: FigureOptions = { ...documentFigure };
  const sourceOptions = cell.options ?? {};
  const sourceOptionKeys = new Set<string>();
  const echoFencedOptionLines: string[] = [];

  for (const key of Object.keys(sourceOptions)) {
    if (!isSupportedChunkOptionKey(key)) {
      throw new Error(
        `Unsupported uv-python chunk option '${key}'. Supported options: ${chunkOptionSummary}.`,
      );
    }
  }
  for (const key of optionKeys) {
    if (key in sourceOptions) {
      options[key] = parseOptionValue(key, sourceOptions[key]);
    }
  }
  for (const key of tableOptionKeys) {
    if (key in sourceOptions) {
      applyTableOrFigureOption(table, figure, key, sourceOptions[key]);
    }
  }
  for (const key of figureOptionKeys) {
    if (key in sourceOptions && key !== "label") {
      applyFigureOption(figure, key, sourceOptions[key]);
    }
  }

  const codeLines: string[] = [];
  for (const line of cell.source.value.split(/\r?\n/)) {
    if (/^\s*#\|/.test(line) && !/^\s*#\|\s*[^:]+:\s*/.test(line)) {
      continue;
    }
    const match = line.match(/^\s*#\|\s*([^:]+):\s*(.*?)\s*$/);
    if (!match) {
      codeLines.push(line);
      continue;
    }
    const key = match[1].trim();
    const value = match[2].trim();
    if (!isSupportedChunkOptionKey(key)) {
      throw new Error(
        `Unsupported uv-python chunk option '${key}'. Supported options: ${chunkOptionSummary}.`,
      );
    }
    if (isSupportedOptionKey(key)) {
      options[key] = parseOptionValue(key, value);
    } else if (isSupportedFigureOptionKey(key) && !isSupportedTableOptionKey(key)) {
      if (!(value === "" && key in sourceOptions)) {
        applyFigureOption(figure, key, value);
      }
    } else {
      if (!(value === "" && key in sourceOptions)) {
        applyTableOrFigureOption(table, figure, key, value);
      }
    }
    sourceOptionKeys.add(key);
    if (!(key === "echo" && options.echo === "fenced")) {
      echoFencedOptionLines.push(`#| ${key}: ${formatEchoFencedOptionValue(key, options, table, figure)}`);
    }
  }

  for (const key of new Set<string>([...optionKeys, ...tableOptionKeys, ...figureOptionKeys])) {
    if (!isSupportedChunkOptionKey(key)) {
      continue;
    }
    if (!(key in sourceOptions) || sourceOptionKeys.has(key)) {
      continue;
    }
    if (key === "echo" && options.echo === "fenced") {
      continue;
    }
    echoFencedOptionLines.push(`#| ${key}: ${formatEchoFencedOptionValue(key, options, table, figure)}`);
  }

  validateChunkMetadata(table, figure);
  return { code: codeLines.join("\n"), options, table, figure, echoFencedOptionLines };
}

function isSupportedOptionKey(key: string): key is keyof ExecutionOptions {
  return (optionKeys as readonly string[]).includes(key);
}

function isSupportedTableOptionKey(key: string): key is typeof tableOptionKeys[number] {
  return (tableOptionKeys as readonly string[]).includes(key);
}

function isSupportedFigureOptionKey(key: string): key is typeof figureOptionKeys[number] {
  return (figureOptionKeys as readonly string[]).includes(key);
}

function isDocumentFigureOptionKey(key: string): key is typeof documentFigureOptionKeys[number] {
  return (documentFigureOptionKeys as readonly string[]).includes(key);
}

function isSupportedChunkOptionKey(key: string): key is keyof ExecutionOptions | typeof tableOptionKeys[number] | typeof figureOptionKeys[number] {
  return isSupportedOptionKey(key) || isSupportedTableOptionKey(key) || isSupportedFigureOptionKey(key);
}

function applyTableOrFigureOption(
  table: TableOptions,
  figure: FigureOptions,
  key: typeof tableOptionKeys[number],
  value: unknown,
): void {
  if (key === "label") {
    const label = parseLabel(value);
    if (label.startsWith("tbl-")) {
      table.label = label;
    } else {
      figure.label = label;
    }
    return;
  }
  table.caption = parseStringChunkOption("tbl-cap", value);
}

function parseLabel(value: unknown): string {
  const label = parseStringChunkOption("label", value);
  if (!label.startsWith("tbl-") && !label.startsWith("fig-")) {
    throw new Error(
      "uv-python chunk option 'label' currently supports only tbl-* table labels or fig-* figure labels.",
    );
  }
  if (!/^(tbl|fig)-[A-Za-z0-9_.:-]+$/.test(label)) {
    throw new Error(
      "uv-python chunk option 'label' must be a simple tbl-* or fig-* identifier without spaces or braces.",
    );
  }
  return label;
}

function applyFigureSetting(
  figure: FigureSettings,
  key: typeof documentFigureOptionKeys[number],
  value: unknown,
): void {
  if (key === "fig-width") {
    figure.width = parsePositiveNumberChunkOption(key, value);
  } else if (key === "fig-height") {
    figure.height = parsePositiveNumberChunkOption(key, value);
  } else if (key === "fig-dpi") {
    figure.dpi = parsePositiveNumberChunkOption(key, value);
  } else {
    figure.format = parseFigureFormat(value);
  }
}

function applyFigureOption(
  figure: FigureOptions,
  key: typeof figureOptionKeys[number],
  value: unknown,
): void {
  if (isDocumentFigureOptionKey(key)) {
    applyFigureSetting(figure, key, value);
  } else if (key === "fig-cap") {
    figure.caption = parseStringOrStringListChunkOption(key, value);
  } else if (key === "fig-alt") {
    figure.alt = parseStringChunkOption(key, value);
  } else if (key === "fig-align") {
    figure.align = parseFigureAlign(value);
  } else if (key === "fig-link") {
    figure.link = parseStringChunkOption(key, value);
  } else if (key === "width") {
    figure.attrWidth = parseImageAttributeDimension(key, value);
  } else if (key === "height") {
    figure.attrHeight = parseImageAttributeDimension(key, value);
  }
}

function validateChunkMetadata(table: TableOptions, figure: FigureOptions): void {
  const hasTableMetadata = table.caption !== undefined || table.label !== undefined;
  const hasFigureMetadata = figure.caption !== undefined || figure.label !== undefined ||
    figure.alt !== undefined || figure.align !== undefined || figure.link !== undefined ||
    figure.attrWidth !== undefined || figure.attrHeight !== undefined;
  if (hasTableMetadata && hasFigureMetadata) {
    throw new Error(
      "uv-python does not support mixing table metadata and figure metadata in the same chunk.",
    );
  }
  if (figure.label !== undefined && figure.caption === undefined) {
    throw new Error(
      "uv-python fig-* labels require fig-cap so Quarto can create a cross-referenceable figure.",
    );
  }
}

function parseStringChunkOption(key: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`uv-python chunk option '${key}' supports only string values.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`uv-python chunk option '${key}' must not be empty.`);
  }
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseStringOrStringListChunkOption(key: string, value: unknown): string | string[] {
  if (Array.isArray(value)) {
    const parsed = value.map((entry) => parseStringChunkOption(key, entry));
    if (parsed.length === 0) {
      throw new Error(`uv-python chunk option '${key}' list must not be empty.`);
    }
    return parsed;
  }
  return parseStringChunkOption(key, value);
}

function parsePositiveNumberChunkOption(key: string, value: unknown): number {
  const numberValue = typeof value === "number"
    ? value
    : typeof value === "string"
    ? Number(parseStringChunkOption(key, value))
    : NaN;
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`uv-python chunk option '${key}' supports only positive numeric values.`);
  }
  return numberValue;
}

function parseFigureFormat(value: unknown): FigureFormat {
  const normalized = parseStringChunkOption("fig-format", value).toLowerCase();
  if (normalized === "png" || normalized === "retina") {
    return "png";
  }
  if (normalized === "svg") {
    return "svg";
  }
  throw new Error("uv-python chunk option 'fig-format' currently supports only png, svg, or retina values.");
}

function parseFigureAlign(value: unknown): "default" | "left" | "right" | "center" {
  const normalized = parseStringChunkOption("fig-align", value).toLowerCase();
  if (normalized === "default" || normalized === "left" || normalized === "right" || normalized === "center") {
    return normalized;
  }
  throw new Error("uv-python chunk option 'fig-align' supports only default, left, right, or center values.");
}

function parseImageAttributeDimension(key: string, value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`uv-python chunk option '${key}' supports only positive numeric or string dimensions.`);
    }
    return String(value);
  }
  return parseStringChunkOption(key, value);
}

function parseOptionValue<K extends keyof ExecutionOptions>(
  key: K,
  value: unknown,
): ExecutionOptions[K] {
  if (key === "echo") {
    return parseEchoValue(value) as ExecutionOptions[K];
  }
  if (key === "output") {
    return parseOutputValue(value) as ExecutionOptions[K];
  }
  return parseBooleanValue(key, value) as ExecutionOptions[K];
}

function parseBooleanValue(key: string, value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  throw new Error(
    `uv-python option '${key}' supports only true or false values.`,
  );
}

function parseEchoValue(value: unknown): boolean | "fenced" {
  if (typeof value === "string" && value.trim().toLowerCase() === "fenced") {
    return "fenced";
  }
  try {
    return parseBooleanValue("echo", value);
  } catch (_error) {
    throw new Error("uv-python option 'echo' supports only true, false, or fenced values.");
  }
}

function parseOutputValue(value: unknown): boolean | "asis" {
  if (typeof value === "string" && value.trim().toLowerCase() === "asis") {
    return "asis";
  }
  try {
    return parseBooleanValue("output", value);
  } catch (_error) {
    throw new Error("uv-python option 'output' supports only true, false, or asis values.");
  }
}

function formatEchoFencedOptionValue(
  key: keyof ExecutionOptions | typeof tableOptionKeys[number] | typeof figureOptionKeys[number],
  options: ExecutionOptions,
  table: TableOptions,
  figure: FigureOptions,
): string {
  const value = isSupportedOptionKey(key)
    ? options[key]
    : key === "label"
    ? table.label ?? figure.label ?? ""
    : key === "tbl-cap"
    ? table.caption ?? ""
    : figureOptionValueForEcho(key, figure);
  if (Array.isArray(value)) {
    return `[${value.join(", ")}]`;
  }
  return typeof value === "boolean" || typeof value === "number" ? String(value) : value;
}

function figureOptionValueForEcho(
  key: typeof figureOptionKeys[number],
  figure: FigureOptions,
): string | number | string[] {
  if (key === "fig-width") {
    return figure.width ?? "";
  }
  if (key === "fig-height") {
    return figure.height ?? "";
  }
  if (key === "fig-dpi") {
    return figure.dpi ?? "";
  }
  if (key === "fig-format") {
    return figure.format;
  }
  if (key === "fig-cap") {
    return figure.caption ?? "";
  }
  if (key === "fig-alt") {
    return figure.alt ?? "";
  }
  if (key === "fig-align") {
    return figure.align ?? "";
  }
  if (key === "fig-link") {
    return figure.link ?? "";
  }
  if (key === "width") {
    return figure.attrWidth ?? "";
  }
  if (key === "height") {
    return figure.attrHeight ?? "";
  }
  return "";
}

function figureSettingsForRunner(figure: FigureOptions): FigureSettings {
  return {
    format: figure.format,
    ...(figure.width !== undefined ? { width: figure.width } : {}),
    ...(figure.height !== undefined ? { height: figure.height } : {}),
    ...(figure.dpi !== undefined ? { dpi: figure.dpi } : {}),
  };
}

function pythonParams(options: ExecuteOptions): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  mergeParams(merged, objectRecord(options.target.metadata)?.params, "document YAML params");
  mergeParams(merged, objectRecord(options.format.metadata)?.params, "format metadata params");
  mergeParams(merged, options.params, "ExecuteOptions params");
  return merged;
}

function mergeParams(
  merged: Record<string, unknown>,
  value: unknown,
  sourceName: string,
): void {
  if (value === undefined) {
    return;
  }
  const params = objectRecord(value);
  if (params === undefined) {
    throw new Error(`uv-python ${sourceName} must be a YAML mapping.`);
  }
  Object.assign(merged, params);
}

function quartoExecuteInfo(
  options: ExecuteOptions,
  documentPath: string,
): Record<string, unknown> {
  return {
    "document-path": documentPath,
    format: {
      identifier: options.format.identifier ?? {},
      execute: options.format.execute ?? {},
      render: options.format.render ?? {},
      pandoc: options.format.pandoc ?? {},
      language: options.format.language ?? {},
      metadata: options.format.metadata ?? {},
    },
  };
}

async function runPythonRunner(input: {
  chunks: RunnerChunk[];
  items: RunnerExecutionItem[];
  documentPath: string;
  documentCwd: string;
  projectRoot: string;
  figureDir: string;
  tempDir: string;
  params: Record<string, unknown>;
  executeInfo: Record<string, unknown>;
}): Promise<RunnerResponse> {
  await Deno.mkdir(input.tempDir, { recursive: true });
  const requestPath = await Deno.makeTempFile({
    dir: input.tempDir,
    prefix: "uv-python-request-",
    suffix: ".json",
  });
  const responsePath = await Deno.makeTempFile({
    dir: input.tempDir,
    prefix: "uv-python-response-",
    suffix: ".json",
  });
  const executeInfoPath = await Deno.makeTempFile({
    dir: input.tempDir,
    prefix: "uv-python-execute-info-",
    suffix: ".json",
  });
  await Deno.writeTextFile(executeInfoPath, JSON.stringify(input.executeInfo, null, 2));

  const request = {
    chunks: input.chunks,
    items: input.items,
    documentPath: input.documentPath,
    documentCwd: input.documentCwd,
    projectRoot: input.projectRoot,
    figureDir: input.figureDir,
    params: input.params,
    responsePath,
  };
  await Deno.writeTextFile(requestPath, JSON.stringify(request, null, 2));

  const runnerPath = join(extensionDir, "runner.py");
  const command = new Deno.Command("uv", {
    args: ["run", "python", runnerPath, requestPath, responsePath],
    cwd: input.projectRoot,
    env: {
      QUARTO_EXECUTE_INFO: executeInfoPath,
    },
    stdout: "piped",
    stderr: "piped",
  });

  const result = await command.output();
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  let response: RunnerResponse | undefined;
  try {
    response = JSON.parse(await Deno.readTextFile(responsePath));
  } catch (_error) {
    response = undefined;
  }

  if (response !== undefined) {
    validateRunnerResponse(response, input.chunks.length);
  }

  if (!result.success) {
    const failedUnit = response?.failedInline !== undefined
      ? `inline expression ${response.failedInline + 1}`
      : response?.failedChunk !== undefined
      ? `chunk ${response.failedChunk + 1}`
      : "runner";
    const details = [
      `uv-python failed while executing ${failedUnit}.`,
      `Command: uv run python ${runnerPath} ${requestPath} ${responsePath}`,
      stdout.trim() ? `uv stdout:\n${stdout}` : "",
      stderr.trim() ? `uv stderr:\n${stderr}` : "",
    ].filter(Boolean).join("\n\n");
    throw new Error(details);
  }

  if (response === undefined) {
    throw new Error("uv-python runner completed without writing response JSON.");
  }
  return response;
}

function validateRunnerResponse(response: RunnerResponse, chunkCount: number): void {
  if (response.protocol !== kOutputProtocolVersion) {
    throw new Error(
      `uv-python runner returned unsupported output protocol '${String(response.protocol)}'. Expected '${kOutputProtocolVersion}'.`,
    );
  }
  if (!Array.isArray(response.events)) {
    throw new Error("uv-python runner response is missing an events array.");
  }
  let previousSequence = -1;
  for (const event of response.events) {
    if (event.protocol !== kOutputProtocolVersion) {
      throw new Error(
        `uv-python runner event ${String(event.sequence)} uses unsupported output protocol '${String(event.protocol)}'.`,
      );
    }
    if (!Number.isInteger(event.sequence) || event.sequence <= previousSequence) {
      throw new Error("uv-python runner events are not in strictly increasing sequence order.");
    }
    previousSequence = event.sequence;
    if (!Number.isInteger(event.chunkIndex)) {
      throw new Error(
        `uv-python runner event ${event.sequence} has invalid chunkIndex '${String(event.chunkIndex)}'.`,
      );
    }
    const hasInlineIndex = event.inlineIndex !== undefined;
    if (hasInlineIndex && (!Number.isInteger(event.inlineIndex) || event.inlineIndex < 0)) {
      throw new Error(
        `uv-python runner event ${event.sequence} has invalid inlineIndex '${String(event.inlineIndex)}'.`,
      );
    }
    if (!hasInlineIndex && (event.chunkIndex < 0 || event.chunkIndex >= chunkCount)) {
      throw new Error(
        `uv-python runner event ${event.sequence} has out-of-range chunkIndex '${String(event.chunkIndex)}'.`,
      );
    }
    if (hasInlineIndex && (event.chunkIndex < -1 || event.chunkIndex >= chunkCount)) {
      throw new Error(
        `uv-python runner inline event ${event.sequence} has out-of-range preceding chunkIndex '${String(event.chunkIndex)}'.`,
      );
    }
    if (!isOutputEventKind(event.kind)) {
      throw new Error(
        `uv-python runner event ${event.sequence} has unsupported kind '${String(event.kind)}'.`,
      );
    }
  }
}

function isOutputEventKind(kind: string): kind is OutputEventKind {
  return [
    "stdout",
    "stderr",
    "warning",
    "error",
    "display_text",
    "display_markdown",
    "display_html",
    "figure",
    "skipped",
  ].includes(kind);
}

function figureArtifactFormatNamespace(options: ExecuteOptions): string {
  const identifier = options.format.identifier;
  const raw = typeof identifier?.["target-format"] === "string" && identifier["target-format"].trim() !== ""
    ? identifier["target-format"]
    : typeof identifier?.["base-format"] === "string" && identifier["base-format"].trim() !== ""
    ? identifier["base-format"]
    : "unknown-format";
  const sanitized = raw.trim().replaceAll(/[^A-Za-z0-9_.-]+/g, "-").replaceAll(/^-+|-+$/g, "");
  return sanitized || "unknown-format";
}

async function clearActiveFigureDir(
  figureDir: string,
  engineFigureRoot: string,
  expectedParentDir: string,
): Promise<void> {
  if (basename(engineFigureRoot) !== kEngineName || dirname(engineFigureRoot) !== expectedParentDir || dirname(figureDir) !== engineFigureRoot) {
    throw new Error(
      `Refusing to clear unexpected uv-python figure directory: ${figureDir}`,
    );
  }

  try {
    await Deno.remove(figureDir, { recursive: true });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return;
    }
    throw error;
  }
}

function renderChunkMarkdown(
  chunk: ParsedChunk,
  output: ChunkEvents | undefined,
  documentCwd: string,
): string {
  const { options } = chunk;
  if (!options.include) {
    return "";
  }

  const rendered: string[] = [];
  if (options.echo === true) {
    rendered.push(fencedBlock(".python", chunk.code));
  } else if (options.echo === "fenced") {
    rendered.push(fencedBlock(".markdown .uv-python-echo-fenced", executableFenceMarkdown(chunk)));
  }

  if (!options.eval || !options.output || output === undefined) {
    return rendered.join("");
  }

  const captionedTableSequence = chunk.table.caption !== undefined
    ? captionedMarkdownTableSequence(chunk, output)
    : undefined;
  const renderedFigureSequences = new Set<number>();
  const figureEvents = output.events.filter((event) => event.kind === "figure");
  if (figureEvents.length > 0) {
    validateFigureRendering(chunk.figure, figureEvents.length);
  } else if (hasFigureRenderingMetadata(chunk.figure)) {
    throw new Error(
      "uv-python figure metadata requires at least one matplotlib figure output in the chunk.",
    );
  }

  for (const event of output.events) {
    switch (event.kind) {
      case "stdout":
        if (options.output === "asis") {
          rendered.push(rawMarkdownBlock(stringPayloadField(event, "text")));
        } else {
          rendered.push(
            fencedBlock(".text .uv-python-stdout", stringPayloadField(event, "text")),
          );
        }
        break;
      case "stderr":
        rendered.push(
          fencedBlock(".text .uv-python-stderr", stringPayloadField(event, "text")),
        );
        break;
      case "warning":
        if (options.warning) {
          rendered.push(
            fencedBlock(".text .uv-python-warning", warningText(event)),
          );
        }
        break;
      case "error":
        if (options.error) {
          rendered.push(
            fencedBlock(".text .uv-python-error", stringPayloadField(event, "traceback")),
          );
        }
        break;
      case "figure": {
        rendered.push(renderFigureMarkdown(chunk.figure, event, documentCwd, renderedFigureSequences.size));
        renderedFigureSequences.add(event.sequence);
        break;
      }
      case "skipped":
        break;
      case "display_text":
        rendered.push(
          fencedBlock(".text .uv-python-display-text", stringPayloadField(event, "text")),
        );
        break;
      case "display_markdown":
        rendered.push(rawMarkdownBlock(
          event.sequence === captionedTableSequence
            ? appendTableCaption(
              stringPayloadField(event, "markdown"),
              chunk.table.caption ?? "",
              chunk.table.label,
            )
            : stringPayloadField(event, "markdown"),
        ));
        break;
      case "display_html":
        rendered.push(rawMarkdownBlock(stringPayloadField(event, "html")));
        break;
      default:
        throw new Error(`Unsupported uv-python event kind '${event.kind}'.`);
    }
  }
  return rendered.join("");
}

function renderMarkdownCellWithInline(
  cell: ParsedMarkdownCell,
  eventsByInline: Map<number, RunnerOutputEvent[]>,
  inlineOptions: Map<number, ExecutionOptions>,
): string {
  return cell.segments.map((segment) => {
    if (segment.kind === "text") {
      return segment.markdown;
    }
    const options = inlineOptions.get(segment.inlineIndex);
    if (options === undefined) {
      throw new Error(`uv-python internal error: missing inline options ${segment.inlineIndex}.`);
    }
    if (!options.include || !options.eval || !options.output) {
      return "";
    }
    const events = eventsByInline.get(segment.inlineIndex) ?? [];
    return events.map((event) => renderInlineEvent(event)).join("");
  }).join("");
}

function renderInlineEvent(event: RunnerOutputEvent): string {
  switch (event.kind) {
    case "stdout":
      return escapeInlineMarkdownText(stringPayloadField(event, "text"));
    case "stderr":
      return escapeInlineMarkdownText(stringPayloadField(event, "text"));
    case "warning":
      return escapeInlineMarkdownText(warningText(event));
    case "display_text":
      return escapeInlineMarkdownText(stringPayloadField(event, "text"));
    case "display_markdown":
      return stringPayloadField(event, "markdown");
    case "display_html":
      return stringPayloadField(event, "html");
    case "skipped":
      return "";
    case "error":
      return escapeInlineMarkdownText(stringPayloadField(event, "traceback"));
    case "figure":
      throw new Error("uv-python inline expressions do not support figure output.");
    default:
      throw new Error(`Unsupported uv-python inline event kind '${event.kind}'.`);
  }
}

function validateFigureRendering(figure: FigureOptions, figureCount: number): void {
  if (figure.label !== undefined && figureCount !== 1) {
    throw new Error(
      "uv-python fig-* labels currently support exactly one figure per chunk; use separate chunks or omit the label for basic multi-figure output.",
    );
  }
  if (figure.label !== undefined && figure.caption === undefined) {
    throw new Error(
      "uv-python fig-* labels require fig-cap so Quarto can create a cross-referenceable figure.",
    );
  }
  if (Array.isArray(figure.caption) && figure.caption.length !== figureCount) {
    throw new Error(
      `uv-python fig-cap list length (${figure.caption.length}) must match the number of figures in the chunk (${figureCount}).`,
    );
  }
}

function hasFigureRenderingMetadata(figure: FigureOptions): boolean {
  return figure.caption !== undefined || figure.label !== undefined || figure.alt !== undefined ||
    figure.align !== undefined || figure.link !== undefined || figure.attrWidth !== undefined ||
    figure.attrHeight !== undefined;
}

function renderFigureMarkdown(
  figure: FigureOptions,
  event: RunnerOutputEvent,
  documentCwd: string,
  figureOrdinal: number,
): string {
  const relPath = relative(documentCwd, stringPayloadField(event, "path"))
    .replaceAll("\\", "/");
  const caption = figureCaptionForOrdinal(figure.caption, figureOrdinal);
  const attributes = figureMarkdownAttributes(figure);
  const imageLabel = caption !== undefined ? escapeMarkdownImageText(caption) : "";
  const image = `![${imageLabel}](${relPath})${attributes}`;
  const linked = figure.link !== undefined ? `[${image}](${figure.link})` : image;
  return `${linked}\n\n`;
}

function figureCaptionForOrdinal(
  caption: string | string[] | undefined,
  figureOrdinal: number,
): string | undefined {
  if (Array.isArray(caption)) {
    return caption[figureOrdinal];
  }
  return caption;
}

function figureMarkdownAttributes(figure: FigureOptions): string {
  const attrs: string[] = [];
  if (figure.label !== undefined) {
    attrs.push(`#${figure.label}`);
  }
  attrs.push(`fig-alt=${markdownAttributeValue(figure.alt ?? "Python figure")}`);
  if (figure.align !== undefined && figure.align !== "default") {
    attrs.push(`fig-align=${markdownAttributeValue(figure.align)}`);
  }
  if (figure.attrWidth !== undefined) {
    attrs.push(`width=${markdownAttributeValue(figure.attrWidth)}`);
  }
  if (figure.attrHeight !== undefined) {
    attrs.push(`height=${markdownAttributeValue(figure.attrHeight)}`);
  }
  return attrs.length > 0 ? `{${attrs.join(" ")}}` : "";
}

function markdownAttributeValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function escapeMarkdownImageText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("]", "\\]").replaceAll("\n", " ");
}

function captionedMarkdownTableSequence(
  chunk: ParsedChunk,
  output: ChunkEvents,
): number {
  const tableEvents = output.events
    .filter((event) => event.kind === "display_markdown")
    .map((event) => ({
      event,
      markdown: stringPayloadField(event, "markdown"),
      blocks: markdownPipeTableBlocks(stringPayloadField(event, "markdown")),
    }))
    .filter((entry) => entry.blocks.length > 0);
  const tableCount = tableEvents.reduce((total, entry) => total + entry.blocks.length, 0);
  if (tableCount !== 1) {
    throw new Error(
      `uv-python tbl-cap requires exactly one Markdown pipe table display event in the chunk; found ${tableCount}. Use one display(Markdown(...)) table per caption.`,
    );
  }
  const tableEvent = tableEvents[0];
  if (!markdownTablePayloadIsOnlyTable(tableEvent.markdown, tableEvent.blocks[0])) {
    throw new Error(
      "uv-python tbl-cap requires the captioned Markdown display payload to contain exactly one pipe table and no leading or trailing Markdown/prose outside that table. Use a separate chunk/event or remove extra content.",
    );
  }
  return tableEvent.event.sequence;
}

function appendTableCaption(
  markdown: string,
  caption: string,
  label: string | undefined,
): string {
  const table = markdown.trimEnd();
  const attr = label !== undefined ? ` {#${label}}` : "";
  return `${table}\n\n: ${caption}${attr}\n\n`;
}

function markdownPipeTableBlocks(markdown: string): MarkdownPipeTableBlock[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: MarkdownPipeTableBlock[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerCells = pipeCells(lines[index]);
    const separatorCells = pipeCells(lines[index + 1]);
    if (headerCells.length === 0 || separatorCells.length === 0) {
      continue;
    }
    if (headerCells.length !== separatorCells.length) {
      continue;
    }
    if (!separatorCells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))) {
      continue;
    }
    const block: MarkdownPipeTableBlock = {
      startLine: index,
      endLine: index + 1,
    };
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      if (lines[rowIndex].trim() === "") {
        break;
      }
      const rowCells = pipeCells(lines[rowIndex]);
      if (rowCells.length !== headerCells.length) {
        break;
      }
      block.endLine = rowIndex;
    }
    blocks.push(block);
    index = block.endLine;
  }
  return blocks;
}

function markdownTablePayloadIsOnlyTable(
  markdown: string,
  block: MarkdownPipeTableBlock,
): boolean {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  return lines.every((line, index) => {
    if (index >= block.startLine && index <= block.endLine) {
      return true;
    }
    return line.trim() === "";
  });
}

function pipeCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return [];
  }
  const withoutLeading = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutOuter = withoutLeading.endsWith("|")
    ? withoutLeading.slice(0, -1)
    : withoutLeading;
  return withoutOuter.split("|").map((cell) => cell.trim());
}

function executableFenceMarkdown(chunk: ParsedChunk): string {
  const bodyLines = [...chunk.echoFencedOptionLines, ...chunk.code.split(/\r?\n/)];
  const body = bodyLines.join("\n");
  const fence = "`".repeat(longestFenceLength(body));
  const normalizedBody = body.endsWith("\n") ? body : `${body}\n`;
  return `${fence}{python}\n${normalizedBody}${fence}\n`;
}

function rawMarkdownBlock(markdown: string): string {
  return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
}

function warningText(event: RunnerOutputEvent): string {
  const formatted = event.metadata?.formatted;
  if (typeof formatted === "string" && formatted.length > 0) {
    return formatted;
  }
  const message = stringPayloadField(event, "message");
  const category = stringPayloadField(event, "category", false);
  const filename = stringPayloadField(event, "filename", false);
  const lineno = numericPayloadField(event, "lineno", false);
  const location = filename ? `${filename}${lineno !== undefined ? `:${lineno}` : ""}: ` : "";
  return `${location}${category ? `${category}: ` : ""}${message}\n`;
}

function stringPayloadField(
  event: RunnerOutputEvent,
  field: string,
  required = true,
): string {
  const value = event.payload[field];
  if (typeof value === "string") {
    return value;
  }
  if (!required && value === undefined) {
    return "";
  }
  throw new Error(
    `uv-python event ${event.sequence} (${event.kind}) is missing string payload field '${field}'.`,
  );
}

function numericPayloadField(
  event: RunnerOutputEvent,
  field: string,
  required = true,
): number | undefined {
  const value = event.payload[field];
  if (typeof value === "number") {
    return value;
  }
  if (!required && value === undefined) {
    return undefined;
  }
  throw new Error(
    `uv-python event ${event.sequence} (${event.kind}) is missing numeric payload field '${field}'.`,
  );
}

function numericMetadataField(
  event: RunnerOutputEvent,
  field: string,
): number | undefined {
  const value = event.metadata?.[field];
  return typeof value === "number" ? value : undefined;
}

function fencedBlock(classes: string, content: string): string {
  const fence = "`".repeat(longestFenceLength(content));
  const normalizedContent = content.endsWith("\n") ? content : `${content}\n`;
  return `${fence} {${classes}}\n${normalizedContent}${fence}\n\n`;
}

function escapeInlineMarkdownText(content: string): string {
  return content
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(/([\\`*_{}\[\]()#+\-.!|$~^])/g, "\\$1")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\n", " ");
}

function longestFenceLength(content: string): number {
  return Math.max(
    3,
    ...Array.from(content.matchAll(/`+/g), (match) => match[0].length + 1),
  );
}
