/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Single source of truth for the `COSMOSDB_E2E_SCREENSHOT` capture knob,
 * shared by the screenshot helper (`webviewHelpers.captureWindowScreenshot`)
 * and the self-managed window-trace fixture (`vscode.ts`).
 *
 * Our tests drive a real VS Code window launched via `_electron.launch`, which
 * Playwright's declarative `use.screenshot` / `use.trace` machinery does not
 * touch (those only cover the runner-managed browser context). So we capture
 * both artifacts ourselves and gate them on a single env var:
 *
 *   COSMOSDB_E2E_SCREENSHOT
 *     unset / other      → screenshot: only-on-failure, trace: off   (default)
 *     off | 0            → screenshot: off,             trace: off
 *     on  | 1            → screenshot: on,              trace: off
 *     only-on-failure    → screenshot: only-on-failure, trace: off
 *     trace              → screenshot: on,              trace: on
 *     trace-on-failure   → screenshot: only-on-failure, trace: only-on-failure
 *
 * The `trace` modes additionally record a self-managed Playwright trace of the
 * VS Code window — screencast screenshots only, no DOM snapshots (the snapshot
 * reconstruction can't reproduce VS Code's canvas shell / cross-origin webviews)
 * — and attach it per test. Opened in the trace viewer it yields the full
 * filmstrip / timeline ("main watch screen") that the runner can't produce for
 * a manually-launched Electron app.
 */

export type CaptureWhen = 'on' | 'off' | 'only-on-failure';

export interface CapturePlan {
    screenshot: CaptureWhen;
    trace: CaptureWhen;
}

export function resolveCapturePlan(env: NodeJS.ProcessEnv = process.env): CapturePlan {
    const raw = (env.COSMOSDB_E2E_SCREENSHOT ?? '').trim().toLowerCase();
    switch (raw) {
        case 'off':
        case '0':
            return { screenshot: 'off', trace: 'off' };
        case 'on':
        case '1':
            return { screenshot: 'on', trace: 'off' };
        case 'trace':
            return { screenshot: 'on', trace: 'on' };
        case 'trace-on-failure':
            return { screenshot: 'only-on-failure', trace: 'only-on-failure' };
        case 'only-on-failure':
        default:
            return { screenshot: 'only-on-failure', trace: 'off' };
    }
}

/**
 * Whether an artifact governed by `when` should be persisted given the test
 * outcome. `failed` is `testInfo.status !== testInfo.expectedStatus`.
 */
export function shouldCapture(when: CaptureWhen, failed: boolean): boolean {
    return when === 'on' || (when === 'only-on-failure' && failed);
}
