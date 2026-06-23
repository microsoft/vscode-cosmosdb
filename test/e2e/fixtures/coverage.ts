/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Lightweight, dependency-free webview coverage for the e2e suite.
 *
 * How it works (and why it's shaped this way):
 *
 *  - Coverage runs build the webview bundle **unminified + with source maps**
 *    (`COSMOSDB_E2E_COVERAGE=1` flips `vite.config.views.mjs`; `globalSetup`
 *    rebuilds `dist/` when needed). The webview still loads that bundle from the
 *    extension's `dist/` over `vscode-resource`, same-origin with the webview
 *    frame — no dev server required.
 *  - We use Playwright's built-in **V8** coverage (`page.coverage`), which is
 *    part of `@playwright/test` — no `nyc` / `istanbul` / `c8` dependencies.
 *  - The webview iframe is forced into the page's renderer process for coverage
 *    runs (see the `--disable-site-isolation-trials` launch flags in
 *    `fixtures/vscode.ts`), so `page.coverage` actually sees its scripts. Without
 *    that flag the webview is an out-of-process iframe and reports nothing.
 *  - For each executed bundle chunk we read its source map (the adjacent
 *    `dist/*.js.map`, or an inline data URI), decode it with a hand-rolled VLQ
 *    reader (~40 lines, no library), and project the executed byte ranges back
 *    onto the original component source lines. The result per component is
 *    simply: which source lines ran and which didn't.
 *
 * This is intentionally approximate (line-level, nearest-enclosing-range
 * semantics) — enough to answer "what's covered for each component?" without
 * pulling in a coverage toolchain.
 */

import { type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

/** Per-component line coverage, written to each test's `coverage.json`. */
export interface FileCoverage {
    /** Repo-relative source path, e.g. `src/webviews/QueryEditor/QueryEditorTab.tsx`. */
    path: string;
    /** Count of executable (source-mapped) lines. */
    totalLines: number;
    /** Count of executable lines that ran at least once. */
    coveredLines: number;
    lineCoveragePercent: number;
    /** 1-based line numbers that carry executable code. */
    mappedLineNumbers: number[];
    /** 1-based line numbers that ran at least once. */
    coveredLineNumbers: number[];
}

interface CoveragePayload {
    testTitle: string;
    testFile: string;
    enabled: boolean;
    files: FileCoverage[];
}

interface V8Range {
    startOffset: number;
    endOffset: number;
    count: number;
}

interface V8Function {
    ranges: V8Range[];
}

interface V8ScriptCoverage {
    url: string;
    source?: string;
    functions: V8Function[];
}

export function isCoverageEnabled(): boolean {
    return process.env.COSMOSDB_E2E_COVERAGE === '1';
}

export async function startCoverage(page: Page): Promise<void> {
    if (!isCoverageEnabled()) {
        return;
    }
    try {
        await page.coverage.startJSCoverage({ resetOnNavigation: false });
    } catch {
        // Coverage is best-effort: never fail the run if this Chromium build
        // doesn't expose the API or the page is already closing.
    }
}

export async function stopAndPersistCoverage(page: Page, testInfo: TestInfo): Promise<void> {
    if (!isCoverageEnabled()) {
        return;
    }

    let entries: V8ScriptCoverage[] = [];
    try {
        entries = (await page.coverage.stopJSCoverage()) as unknown as V8ScriptCoverage[];
    } catch {
        // Ignore — emit an empty (but valid) artifact below so aggregation
        // still has something to read.
    }

    const files = buildFileCoverage(entries);

    if (process.env.COSMOSDB_E2E_COVERAGE_DEBUG === '1') {
        const debugFile = testInfo.outputPath('coverage-urls.json');
        try {
            writeFileSync(
                debugFile,
                JSON.stringify(
                    {
                        total: entries.length,
                        urls: entries.map((e) => ({
                            url: e.url,
                            hasSource: !!e.source,
                            functions: e.functions.length,
                        })),
                    },
                    null,
                    2,
                ),
                'utf-8',
            );
        } catch {
            // best-effort debug only
        }
    }

    const payload: CoveragePayload = {
        testTitle: testInfo.title,
        testFile: testInfo.file,
        enabled: true,
        files,
    };

    const file = testInfo.outputPath('coverage.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');

    try {
        await testInfo.attach('coverage', { path: file, contentType: 'application/json' });
    } catch {
        // Best-effort — never fail the test if the reporter can't attach.
    }
}

/**
 * Projects V8 byte-range coverage of the webview bundle chunks back onto their
 * original component source lines, merging per source file across chunks.
 */
function buildFileCoverage(entries: V8ScriptCoverage[]): FileCoverage[] {
    // path -> { mapped: Set<line>, covered: Set<line> }
    const perFile = new Map<string, { mapped: Set<number>; covered: Set<number> }>();

    for (const entry of entries) {
        if (!entry.source || !isWebviewBundleUrl(entry.url)) {
            continue;
        }
        const map = readSourceMap(entry.url, entry.source);
        if (!map) {
            continue;
        }
        // Skip vendor/runtime chunks: only decode maps that carry our component
        // sources (monaco's map alone is huge — never pay to decode it).
        if (!map.sources.some((s) => normalizeSourcePath(s, entry.url) !== undefined)) {
            continue;
        }

        const coveredGenLines = computeCoveredGeneratedLines(entry.source, entry.functions);
        const decoded = decodeMappings(map.mappings);

        for (const segment of decoded) {
            const sourcePath = normalizeSourcePath(map.sources[segment.sourceIndex], entry.url);
            if (!sourcePath) {
                continue;
            }
            let bucket = perFile.get(sourcePath);
            if (!bucket) {
                bucket = { mapped: new Set<number>(), covered: new Set<number>() };
                perFile.set(sourcePath, bucket);
            }
            const sourceLine = segment.sourceLine + 1; // 0-based -> 1-based
            bucket.mapped.add(sourceLine);
            if (coveredGenLines.has(segment.generatedLine)) {
                bucket.covered.add(sourceLine);
            }
        }
    }

    const result: FileCoverage[] = [];
    for (const [filePath, bucket] of perFile) {
        const mappedLineNumbers = [...bucket.mapped].sort((a, b) => a - b);
        // A line can be mapped from several generated lines; it counts as
        // covered if any of them ran.
        const coveredLineNumbers = mappedLineNumbers.filter((line) => bucket.covered.has(line));
        const totalLines = mappedLineNumbers.length;
        const coveredLines = coveredLineNumbers.length;
        result.push({
            path: filePath,
            totalLines,
            coveredLines,
            lineCoveragePercent: totalLines === 0 ? 100 : Math.round((coveredLines / totalLines) * 1000) / 10,
            mappedLineNumbers,
            coveredLineNumbers,
        });
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * True for the extension's own webview bundle chunks (loaded from `dist/` over
 * `vscode-resource`). Excludes VS Code's own workbench scripts, electron
 * internals and anything outside `dist/`.
 */
function isWebviewBundleUrl(url: string): boolean {
    if (!url.endsWith('.js') && !url.includes('.js?')) {
        return false;
    }
    const local = urlToLocalPath(url);
    return local !== undefined && local.replace(/\\/g, '/').includes('/dist/');
}

/**
 * Maps a `vscode-resource` / `file://` webview URL back to its on-disk path so
 * we can read the adjacent `.map`. Returns `undefined` for non-local schemes.
 */
function urlToLocalPath(url: string): string | undefined {
    const withoutQuery = url.split('?')[0];
    // vscode-resource webview URLs look like
    // `https://file+.vscode-resource.vscode-cdn.net/c:/path/dist/chunk.js`.
    const cdnMatch = /vscode-(?:resource|cdn)[^/]*\/(.+)$/.exec(withoutQuery);
    if (cdnMatch) {
        try {
            return decodeURIComponent(cdnMatch[1]);
        } catch {
            return cdnMatch[1];
        }
    }
    if (withoutQuery.startsWith('file://')) {
        try {
            return decodeURIComponent(new URL(withoutQuery).pathname.replace(/^\/([a-zA-Z]:)/, '$1'));
        } catch {
            return undefined;
        }
    }
    return undefined;
}

/**
 * Turns a source-map `sources` entry into a stable repo-relative key, or
 * `undefined` for anything outside the webview source trees we care about.
 * Bundle source maps store `sources` relative to the chunk (e.g.
 * `../src/webviews/...`), so we resolve against the chunk URL first.
 */
function normalizeSourcePath(rawSource: string | undefined, moduleUrl: string): string | undefined {
    if (!rawSource) {
        return undefined;
    }
    let resolved: string;
    try {
        resolved = new URL(rawSource, moduleUrl).pathname;
    } catch {
        resolved = rawSource;
    }
    const source = resolved.split('?')[0].replace(/\\/g, '/').replace(/^\//, '');
    const webviewsIdx = source.indexOf('src/webviews/');
    if (webviewsIdx >= 0) {
        return source.slice(webviewsIdx);
    }
    const packagesIdx = source.indexOf('packages/');
    if (packagesIdx >= 0) {
        return source.slice(packagesIdx);
    }
    return undefined;
}

interface ParsedSourceMap {
    mappings: string;
    sources: string[];
}

/**
 * Resolves a chunk's source map from the trailing `//# sourceMappingURL=`
 * comment. Supports both an inline `data:...;base64,<...>` URI and an adjacent
 * `chunk.js.map` file on disk (the shape Vite's production build emits). Returns
 * `undefined` when no usable map is found.
 */
function readSourceMap(scriptUrl: string, source: string): ParsedSourceMap | undefined {
    const marker = '//# sourceMappingURL=';
    const idx = source.lastIndexOf(marker);
    if (idx < 0) {
        return undefined;
    }
    const ref = source
        .slice(idx + marker.length)
        .trim()
        .split(/\s/)[0];

    const inline = /^data:application\/json[^,]*;base64,(.*)$/.exec(ref);
    if (inline) {
        return parseSourceMapJson(Buffer.from(inline[1], 'base64').toString('utf-8'));
    }
    if (ref.startsWith('data:')) {
        const comma = ref.indexOf(',');
        return comma >= 0 ? parseSourceMapJson(decodeURIComponent(ref.slice(comma + 1))) : undefined;
    }

    // External `.map` next to the chunk on disk.
    const scriptPath = urlToLocalPath(scriptUrl);
    if (!scriptPath) {
        return undefined;
    }
    try {
        const mapPath = path.resolve(path.dirname(scriptPath), ref);
        return parseSourceMapJson(readFileSync(mapPath, 'utf-8'));
    } catch {
        return undefined;
    }
}

function parseSourceMapJson(json: string): ParsedSourceMap | undefined {
    try {
        const parsed = JSON.parse(json) as { mappings?: string; sources?: string[] };
        if (typeof parsed.mappings !== 'string' || !Array.isArray(parsed.sources)) {
            return undefined;
        }
        return { mappings: parsed.mappings, sources: parsed.sources };
    } catch {
        return undefined;
    }
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < BASE64_CHARS.length; i++) {
    BASE64_LOOKUP[BASE64_CHARS[i]] = i;
}

/** Decodes one Base64-VLQ group (a comma-delimited segment) into integers. */
function decodeVlq(segment: string): number[] {
    const result: number[] = [];
    let shift = 0;
    let value = 0;
    for (const char of segment) {
        const integer = BASE64_LOOKUP[char];
        if (integer === undefined) {
            break;
        }
        const hasContinuation = integer & 32;
        value += (integer & 31) << shift;
        if (hasContinuation) {
            shift += 5;
        } else {
            const shouldNegate = value & 1;
            value >>>= 1;
            result.push(shouldNegate ? -value : value);
            value = 0;
            shift = 0;
        }
    }
    return result;
}

interface DecodedSegment {
    generatedLine: number; // 0-based generated line
    sourceIndex: number;
    sourceLine: number; // 0-based original line
}

/**
 * Decodes a source-map `mappings` string into the subset of fields we need:
 * which original (source, line) each generated line maps to. Column data is
 * intentionally dropped — we work at line granularity.
 */
function decodeMappings(mappings: string): DecodedSegment[] {
    const decoded: DecodedSegment[] = [];
    let sourceIndex = 0;
    let sourceLine = 0;
    // `generatedColumn`, `sourceColumn` and `nameIndex` deltas are consumed but
    // not retained.
    const generatedLineGroups = mappings.split(';');
    for (let generatedLine = 0; generatedLine < generatedLineGroups.length; generatedLine++) {
        const group = generatedLineGroups[generatedLine];
        if (group.length === 0) {
            continue;
        }
        for (const segment of group.split(',')) {
            if (segment.length === 0) {
                continue;
            }
            const fields = decodeVlq(segment);
            // A segment with only a generated column carries no source mapping.
            if (fields.length < 4) {
                continue;
            }
            sourceIndex += fields[1];
            sourceLine += fields[2];
            decoded.push({ generatedLine, sourceIndex, sourceLine });
        }
    }
    return decoded;
}

/**
 * Returns the set of 0-based generated line numbers that V8 reports as executed,
 * using nearest-enclosing-range semantics (a line is covered iff the innermost
 * V8 range overlapping the start of its content has a non-zero hit count).
 */
function computeCoveredGeneratedLines(source: string, functions: V8Function[]): Set<number> {
    const lineStarts = computeLineStartOffsets(source);
    const firstContentOffset = computeFirstContentOffsets(source, lineStarts);

    const ranges: V8Range[] = [];
    for (const fn of functions) {
        for (const range of fn.ranges) {
            ranges.push(range);
        }
    }

    const covered = new Set<number>();
    for (let line = 0; line < lineStarts.length; line++) {
        const offset = firstContentOffset[line];
        if (offset < 0) {
            continue; // blank line — nothing executable here
        }
        let innermost: V8Range | undefined;
        for (const range of ranges) {
            if (range.startOffset <= offset && offset < range.endOffset) {
                if (
                    !innermost ||
                    range.startOffset > innermost.startOffset ||
                    (range.startOffset === innermost.startOffset && range.endOffset < innermost.endOffset)
                ) {
                    innermost = range;
                }
            }
        }
        if (innermost && innermost.count > 0) {
            covered.add(line);
        }
    }
    return covered;
}

/** Byte offset at which each 0-based line begins. */
function computeLineStartOffsets(source: string): number[] {
    const starts = [0];
    for (let i = 0; i < source.length; i++) {
        if (source.charCodeAt(i) === 10 /* \n */) {
            starts.push(i + 1);
        }
    }
    return starts;
}

/**
 * Byte offset of the first non-whitespace character on each line, or -1 for a
 * blank line. Using the first real token (rather than the raw line start) makes
 * the nearest-enclosing-range lookup land inside the statement's range.
 */
function computeFirstContentOffsets(source: string, lineStarts: number[]): number[] {
    const offsets: number[] = [];
    for (let line = 0; line < lineStarts.length; line++) {
        const start = lineStarts[line];
        const end = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : source.length;
        let found = -1;
        for (let i = start; i < end; i++) {
            const code = source.charCodeAt(i);
            if (code !== 32 /* space */ && code !== 9 /* tab */ && code !== 13 /* \r */) {
                found = i;
                break;
            }
        }
        offsets.push(found);
    }
    return offsets;
}
