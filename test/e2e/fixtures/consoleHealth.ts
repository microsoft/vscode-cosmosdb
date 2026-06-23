/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Console-health monitor for Query Editor (and other webview) e2e specs.
 *
 * Why: the requirement for the Query Editor coverage is "no errors in the
 * console while driving the UI". Playwright surfaces every `console.*` call
 * made inside a page — including those emitted from nested webview iframes —
 * as a `console` event on the owning `Page`. We attach a single listener at
 * the moment the webview mounts, buffer the messages, and let the spec assert
 * at the end of each interaction.
 *
 * Scoping: VS Code loads webview content from the `vscode-webview://` origin
 * (see the iframe structure documented in `webviewHelpers.ts`). We therefore
 * only record messages whose `location().url` lives under that origin, so the
 * workbench's own renderer/extension-host noise never trips a Query Editor
 * test. In our specs the Query Editor is the only webview open at a time, so
 * this origin filter is effectively scoped to the panel under test.
 *
 * Policy (per PRD): FAIL on `console.error` not matched by
 * {@link CONSOLE_ERROR_ALLOWLIST}; only LOG warnings (they are collected and
 * exposed via {@link ConsoleHealth.warnings} but never fail a test on their
 * own).
 */

import { type ConsoleMessage, type Frame } from '@playwright/test';

/**
 * Documented, intentional exceptions to the "no console errors" rule.
 *
 * Each entry MUST carry a comment explaining why the error is benign and
 * cannot reasonably be eliminated from the webview. Keep this list as small
 * as possible — an empty list is the goal. Matched against the full console
 * message text (`ConsoleMessage.text()`).
 */
export const CONSOLE_ERROR_ALLOWLIST: RegExp[] = [
    // (intentionally empty — add documented entries only as real, unavoidable
    //  errors are discovered while building out the suite)
];

export interface ConsoleHealth {
    /**
     * Throws if any non-allowlisted `console.error` was observed in the
     * webview since this monitor started (or since the last {@link reset}).
     */
    assertNoConsoleErrors(): void;
    /** Snapshot of the `console.warn` messages seen so far. */
    warnings(): string[];
    /** Snapshot of the non-allowlisted `console.error` messages seen so far. */
    errors(): string[];
    /** Clears the buffered errors/warnings without detaching the listener. */
    reset(): void;
    /** Detaches the listener. Safe to call multiple times. */
    dispose(): void;
}

const WEBVIEW_ORIGIN = 'vscode-webview://';

/**
 * Starts buffering console errors/warnings emitted from webview frames on the
 * page that owns {@link frame}. Call {@link ConsoleHealth.dispose} (typically
 * in `afterEach`) to detach.
 */
export function startConsoleHealth(frame: Frame): ConsoleHealth {
    const page = frame.page();
    const errors: string[] = [];
    const warnings: string[] = [];

    const listener = (msg: ConsoleMessage): void => {
        const url = msg.location().url ?? '';
        // Only consider messages originating from webview content, not the
        // VS Code workbench shell.
        if (!url.startsWith(WEBVIEW_ORIGIN)) {
            return;
        }

        const text = msg.text();
        switch (msg.type()) {
            case 'error':
                if (CONSOLE_ERROR_ALLOWLIST.some((re) => re.test(text))) {
                    return;
                }
                errors.push(`${text}  (${url})`);
                break;
            case 'warning':
                warnings.push(`${text}  (${url})`);
                break;
            default:
                break;
        }
    };

    page.on('console', listener);

    let disposed = false;
    return {
        assertNoConsoleErrors(): void {
            if (errors.length > 0) {
                throw new Error(
                    `Unexpected webview console.error output (${errors.length}):\n` +
                        errors.map((e) => `  - ${e}`).join('\n'),
                );
            }
        },
        warnings: () => [...warnings],
        errors: () => [...errors],
        reset(): void {
            errors.length = 0;
            warnings.length = 0;
        },
        dispose(): void {
            if (disposed) {
                return;
            }
            disposed = true;
            page.off('console', listener);
        },
    };
}
