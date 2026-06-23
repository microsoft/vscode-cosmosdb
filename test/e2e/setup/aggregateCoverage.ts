/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { ensureE2eIsolationContext } from '../helpers/e2eIsolation';

interface CoverageFileEntry {
    path: string;
    mappedLineNumbers?: number[];
    coveredLineNumbers?: number[];
}

interface CoverageArtifact {
    testTitle?: string;
    files?: CoverageFileEntry[];
}

interface SummaryEntry {
    path: string;
    totalLines: number;
    coveredLines: number;
    lineCoveragePercent: number;
    testCount: number;
    coveredLineNumbers: number[];
    uncoveredLineNumbers: number[];
}

interface CoverageReport {
    generatedAt: string;
    resultsRootDir: string;
    reportsRootDir: string;
    artifactCount: number;
    totals: {
        components: number;
        totalLines: number;
        coveredLines: number;
        lineCoveragePercent: number;
    };
    entries: SummaryEntry[];
}

function collectCoverageArtifacts(rootDir: string): string[] {
    if (!existsSync(rootDir)) {
        return [];
    }

    const result: string[] = [];
    const stack: string[] = [rootDir];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || !existsSync(current)) {
            continue;
        }
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
            } else if (entry.isFile() && entry.name === 'coverage.json') {
                result.push(fullPath);
            }
        }
    }
    return result.sort((a, b) => a.localeCompare(b));
}

function renderMarkdown(report: CoverageReport): string {
    const lines: string[] = [
        '# E2E webview coverage summary',
        '',
        `- Generated: ${report.generatedAt}`,
        `- Coverage artifacts: ${report.artifactCount}`,
        `- Results root: ${report.resultsRootDir}`,
        `- Total: ${report.totals.coveredLines}/${report.totals.totalLines} lines ` +
            `(${report.totals.lineCoveragePercent}%) across ${report.totals.components} components`,
        '',
        '## Components',
        '',
    ];

    if (report.entries.length === 0) {
        lines.push('No coverage data collected.');
        return lines.join('\n');
    }

    const tree = buildTree(report.entries);
    renderTreeNode(tree, lines, 0);

    return lines.join('\n');
}

interface TreeNode {
    children: Map<string, TreeNode>;
    entry?: SummaryEntry;
    coveredLines: number;
    totalLines: number;
}

function createTreeNode(): TreeNode {
    return { children: new Map(), coveredLines: 0, totalLines: 0 };
}

function buildTree(entries: SummaryEntry[]): TreeNode {
    const root = createTreeNode();
    for (const entry of entries) {
        const segments = entry.path.split('/');
        let node = root;
        node.coveredLines += entry.coveredLines;
        node.totalLines += entry.totalLines;
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            let child = node.children.get(segment);
            if (!child) {
                child = createTreeNode();
                node.children.set(segment, child);
            }
            child.coveredLines += entry.coveredLines;
            child.totalLines += entry.totalLines;
            if (i === segments.length - 1) {
                child.entry = entry;
            }
            node = child;
        }
    }
    return root;
}

function percent(covered: number, total: number): number {
    return total === 0 ? 100 : Math.round((covered / total) * 1000) / 10;
}

function renderTreeNode(node: TreeNode, lines: string[], depth: number): void {
    const sorted = [...node.children.entries()].sort((a, b) => {
        const aDir = a[1].children.size > 0;
        const bDir = b[1].children.size > 0;
        if (aDir !== bDir) {
            return aDir ? -1 : 1;
        }
        return a[0].localeCompare(b[0]);
    });

    for (const [name, child] of sorted) {
        const indent = '  '.repeat(depth);
        const stats = `${child.coveredLines}/${child.totalLines} (${percent(child.coveredLines, child.totalLines)}%)`;
        if (child.entry) {
            lines.push(`${indent}- 📄 ${name} — ${stats}`);
            if (child.entry.uncoveredLineNumbers.length > 0) {
                lines.push(`${indent}  - Uncovered: ${formatLineRanges(child.entry.uncoveredLineNumbers)}`);
            }
        } else {
            // Collapse single-child directory chains (e.g. `a/b/c`) into one line.
            let label = name;
            let current = child;
            while (current.children.size === 1 && !current.entry) {
                const [onlyName, onlyChild] = [...current.children.entries()][0];
                if (onlyChild.entry) {
                    break;
                }
                label += `/${onlyName}`;
                current = onlyChild;
            }
            lines.push(`${indent}- 📁 ${label}/ — ${stats}`);
            renderTreeNode(current, lines, depth + 1);
        }
    }
}

/** Collapses a sorted list of line numbers into compact `a-b, c, e-f` ranges. */
function formatLineRanges(sortedLines: number[]): string {
    const ranges: string[] = [];
    let start = sortedLines[0];
    let prev = sortedLines[0];
    for (let i = 1; i < sortedLines.length; i++) {
        const n = sortedLines[i];
        if (n === prev + 1) {
            prev = n;
            continue;
        }
        ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
        start = n;
        prev = n;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    return ranges.join(', ');
}

export function aggregateCoverageArtifacts(): void {
    const isolation = ensureE2eIsolationContext();
    const reportsDir = isolation.reportsRootDir;
    mkdirSync(reportsDir, { recursive: true });

    const artifactFiles = collectCoverageArtifacts(isolation.resultsRootDir);
    if (artifactFiles.length === 0) {
        console.log('[e2e coverage] No coverage artifacts found.');
        return;
    }

    const perArtifact: CoverageArtifact[] = artifactFiles.map(
        (file) => JSON.parse(readFileSync(file, 'utf-8')) as CoverageArtifact,
    );
    // path -> { mapped: Set<line>, covered: Set<line>, tests: Set<title> }
    const aggregateMap = new Map<string, { mapped: Set<number>; covered: Set<number>; tests: Set<string> }>();

    for (const artifact of perArtifact) {
        const files = artifact.files ?? [];
        for (const entry of files) {
            let current = aggregateMap.get(entry.path);
            if (!current) {
                current = { mapped: new Set(), covered: new Set(), tests: new Set() };
                aggregateMap.set(entry.path, current);
            }
            for (const line of entry.mappedLineNumbers ?? []) {
                current.mapped.add(line);
            }
            for (const line of entry.coveredLineNumbers ?? []) {
                current.covered.add(line);
            }
            current.tests.add(artifact.testTitle ?? '');
        }
    }

    const entries: SummaryEntry[] = Array.from(aggregateMap.entries())
        .map(([filePath, data]) => {
            const mappedLineNumbers = [...data.mapped].sort((a, b) => a - b);
            // A line counts as covered if it ran in *any* test.
            const coveredLineNumbers = mappedLineNumbers.filter((line) => data.covered.has(line));
            const uncoveredLineNumbers = mappedLineNumbers.filter((line) => !data.covered.has(line));
            const totalLines = mappedLineNumbers.length;
            const coveredLines = coveredLineNumbers.length;
            return {
                path: filePath,
                totalLines,
                coveredLines,
                lineCoveragePercent: totalLines === 0 ? 100 : Math.round((coveredLines / totalLines) * 1000) / 10,
                testCount: data.tests.size,
                coveredLineNumbers,
                uncoveredLineNumbers,
            };
        })
        .sort((a, b) => a.path.localeCompare(b.path));

    const totalMapped = entries.reduce((sum, e) => sum + e.totalLines, 0);
    const totalCovered = entries.reduce((sum, e) => sum + e.coveredLines, 0);

    const report: CoverageReport = {
        generatedAt: new Date().toISOString(),
        resultsRootDir: isolation.resultsRootDir,
        reportsRootDir: reportsDir,
        artifactCount: perArtifact.length,
        totals: {
            components: entries.length,
            totalLines: totalMapped,
            coveredLines: totalCovered,
            lineCoveragePercent: totalMapped === 0 ? 100 : Math.round((totalCovered / totalMapped) * 1000) / 10,
        },
        entries,
    };

    const reportFile = path.join(reportsDir, 'coverage-summary.json');
    const markdownFile = path.join(reportsDir, 'coverage-summary.md');
    writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf-8');
    writeFileSync(markdownFile, renderMarkdown(report), 'utf-8');
    console.log(
        `[e2e coverage] Aggregated ${artifactFiles.length} artifacts → ${entries.length} components ` +
            `(${report.totals.lineCoveragePercent}% lines) at ${reportFile}`,
    );
}
