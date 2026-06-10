/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Integration test entry point that runs inside the VS Code Extension Host.
 *
 * Architecture: instead of pulling in mocha + @vscode/test-cli, we drive @vitest/runner
 * directly. That means integration tests use the same API as unit tests
 * (`import { describe, it, expect } from 'vitest'`) but execute inside a real VS Code
 * process so they get access to the real `vscode` module.
 *
 * This file is invoked by @vscode/test-electron via `extensionTestsPath`. It MUST export
 * a `run(): Promise<void>` function. Throwing from `run()` is what makes the host report
 * a failing test run.
 */

import { startTests, type File, type Task, type VitestRunner } from '@vitest/runner';
import { glob } from 'glob';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// On Windows VS Code may launch the extension host with a lower-case drive letter
// (e.g. `c:\...`) while OS-level filesystem APIs (used by `glob`, `realpathSync`, etc.)
// return the canonical upper-case form. In ESM, modules are cached by URL, so the two
// casings would load `@vitest/runner` twice — losing the `describe`/`it` collector
// state set by `clearCollectorContext()`. We anchor every URL we emit to the same
// directory that `import.meta.url` was loaded from, so they share one cache entry.
const here = path.dirname(fileURLToPath(import.meta.url));

const HOOK_TIMEOUT_MS = 2 * 60 * 1000;
const TEST_TIMEOUT_MS = 20_000;

// Minimum config required by @vitest/runner. Most fields just need sane defaults —
// the runner itself decides everything from sequencing to timeouts based on this.
const runnerConfig = {
    root: path.resolve(here, '..', '..'),
    setupFiles: [] as string[],
    name: 'integration',
    passWithNoTests: false,
    testNamePattern: undefined,
    allowOnly: true,
    sequence: {
        shuffle: false,
        concurrent: false,
        seed: Date.now(),
        hooks: 'stack' as const,
        setupFiles: 'list' as const,
    },
    chaiConfig: { truncateThreshold: 40 },
    maxConcurrency: 1,
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: HOOK_TIMEOUT_MS,
    retry: 0,
    includeTaskLocation: false,
    tags: [],
    tagsFilter: undefined,
    strictTags: false,
};

class IntegrationRunner implements VitestRunner {
    readonly config = runnerConfig;
    readonly pool = 'forks';

    async importFile(filepath: string): Promise<void> {
        await import(pathToFileURL(filepath).href);
    }
}

function* walk(task: Task): IterableIterator<Task> {
    yield task;
    if (task.type === 'suite') {
        for (const child of task.tasks) yield* walk(child);
    }
}

function fullName(task: Task): string {
    const names: string[] = [];
    let current: Task | undefined = task;
    while (current && !('filepath' in current)) {
        names.unshift(current.name);
        current = current.suite;
    }
    return names.join(' > ');
}

interface RunSummary {
    passed: number;
    failed: number;
    skipped: number;
    failures: { name: string; errors: string[] }[];
    durationMs: number;
}

function summarise(files: File[], durationMs: number): RunSummary {
    const summary: RunSummary = { passed: 0, failed: 0, skipped: 0, failures: [], durationMs };
    for (const file of files) {
        // A file can fail during collection (e.g. import threw) — in that case it has
        // file.result.state === 'fail' but no test tasks. Count those as one failure.
        if (file.result?.state === 'fail' && (file.tasks.length === 0 || !someTestRan(file))) {
            summary.failed++;
            summary.failures.push({
                name: `[collection] ${path.relative(runnerConfig.root, file.filepath)}`,
                errors: file.result.errors?.map(formatError) ?? ['unknown collection error'],
            });
        }
        for (const task of walk(file)) {
            if (task.type !== 'test') continue;
            const state = task.result?.state;
            if (state === 'pass') summary.passed++;
            else if (state === 'fail') {
                summary.failed++;
                summary.failures.push({
                    name: fullName(task),
                    errors: task.result?.errors?.map(formatError) ?? [],
                });
            } else if (state === 'skip' || state === 'todo') summary.skipped++;
        }
    }
    return summary;
}

function someTestRan(file: File): boolean {
    for (const task of walk(file)) {
        if (task.type === 'test' && task.result) return true;
    }
    return false;
}

function formatError(e: unknown): string {
    if (!e) return 'unknown error';
    const msg = typeof e === 'string' ? e : ((e as { message?: string }).message ?? String(e));
    const stack = typeof e === 'object' && e !== null && 'stack' in e ? (e as { stack?: string }).stack : undefined;
    return stack ? `${msg}\n${stack}` : msg;
}

function printSummary(summary: RunSummary): void {
    console.log('');
    console.log('─'.repeat(60));
    console.log(
        `Tests: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped — ${summary.durationMs}ms`,
    );
    if (summary.failures.length) {
        console.log('');
        console.log('Failures:');
        for (const f of summary.failures) {
            console.log(`  ✗ ${f.name}`);
            for (const err of f.errors) {
                for (const line of err.split('\n')) console.log(`      ${line}`);
            }
        }
    }
    console.log('─'.repeat(60));
}

export async function run(): Promise<void> {
    // Compiled test files live next to this entry under out/test/**.
    // `here` is e.g. <repo>/out/test, so we glob inside it. We deliberately glob with
    // relative paths and then resolve them through `here` (rather than using
    // `absolute: true`), so the resulting paths share the same drive-letter case as
    // `import.meta.url`. See the comment on `here` above.
    const relFiles = await glob('**/*.test.js', { cwd: here });
    if (relFiles.length === 0) {
        throw new Error(`No test files found under ${here}.`);
    }
    const files = relFiles.map((rel) => path.join(here, rel));

    console.log(`Running ${files.length} test file(s) with @vitest/runner inside the VS Code Extension Host`);
    for (const f of files) console.log(`  • ${path.relative(runnerConfig.root, f)}`);

    const runner = new IntegrationRunner();
    const started = Date.now();
    const results = await startTests(files, runner);

    const summary = summarise(results, Date.now() - started);

    printSummary(summary);

    if (summary.failed > 0) {
        throw new Error(`${summary.failed} test(s) failed.`);
    }
}
