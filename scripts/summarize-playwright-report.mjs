/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function escapeHtml(text) {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function summarizePlaywrightReport(report) {
    const flakyTests = [];
    function visit(suite, parents) {
        const titles = [...parents, suite.title].filter(Boolean);
        for (const spec of suite.specs) {
            for (const test of spec.tests) {
                if (test.status === 'flaky') {
                    const name = escapeHtml([...titles, spec.title].join(' › '));
                    const location = escapeHtml(`${spec.file}:${spec.line}`);
                    const project = escapeHtml(test.projectName);
                    flakyTests.push(
                        `- <code>${name}</code> — <code>${location}</code> ` +
                            `(${project}, ${test.results.length} attempts)`,
                    );
                }
            }
        }
        for (const child of suite.suites ?? []) {
            visit(child, titles);
        }
    }
    for (const suite of report.suites) {
        visit(suite, []);
    }
    if (flakyTests.length === 0) {
        return '';
    }
    return [
        `## ⚠️ Flaky tests (${flakyTests.length})`,
        '',
        'These tests passed only after retrying. The test run is still successful unless other tests failed.',
        '',
        ...flakyTests,
        '',
    ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const summary = summarizePlaywrightReport(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    process.stdout.write(summary);
    if (summary) {
        console.error('::warning::Flaky E2E tests passed on retry. See the job summary and Playwright report.');
    }
}
