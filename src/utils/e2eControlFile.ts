/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Small, shared primitives for the file-based e2e AI mocks.
 *
 * The offline mocks (`commands/e2eTestCommands/e2eAiMock.ts` and — eventually —
 * `panels/migration/helpers/e2eMigrationAiMock.ts`) are driven by a per-worker
 * JSON control file the Playwright fixtures write. These helpers centralize the
 * low-level plumbing — a cancellable sleep and best-effort JSON reads — so each
 * mock only owns its own control shape and routing. E2e-only.
 *
 * (Migration still has its own copies today; it can adopt these incrementally.)
 */

import { readFileSync, statSync } from 'node:fs';
import type * as vscode from 'vscode';

/** Cancellable sleep — resolves early when the request's cancellation token fires. */
export function delay(ms: number, token?: vscode.CancellationToken): Promise<void> {
    return new Promise((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        let disposable: { dispose: () => void } | undefined;

        const finish = () => {
            if (timer) {
                clearTimeout(timer);
            }
            disposable?.dispose();
            resolve();
        };

        disposable = token?.onCancellationRequested(finish);
        timer = setTimeout(finish, ms);
    });
}

/**
 * Best-effort read + `JSON.parse` of a control file. Returns `undefined` when
 * the file is missing or unparseable, so the mock behaves as if no control is set.
 */
export function readJsonControlFile<T>(filePath: string): T | undefined {
    try {
        return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
    } catch {
        return undefined;
    }
}

/** Last-modified time (ms) of a file, or `undefined` when it doesn't exist. */
export function getFileMtimeMs(filePath: string): number | undefined {
    try {
        return statSync(filePath).mtimeMs;
    } catch {
        return undefined;
    }
}
