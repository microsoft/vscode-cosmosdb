/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Multi-step workbench-readiness helper, adapted from the sibling
 * `vs-code-postgresql` repo. Replaces the naive `.monaco-workbench.waitFor()`
 * with a hardened sequence:
 *
 *   1. wait for DOM content loaded
 *   2. wait for `.monaco-workbench` to be ATTACHED (present in the DOM but
 *      not necessarily painted)
 *   3. force every Electron BrowserWindow to be restored / sized / shown
 *      (handles the case where a secondary window is created first and the
 *      real workbench is hidden behind it)
 *   4. wait for `.monaco-workbench` to be VISIBLE, dumping rich diagnostics
 *      to the console + a screenshot on failure
 *
 * Critical for CI runs where launch races (window ordering, GPU init, etc.)
 * surface as "workbench never visible" instead of meaningful errors.
 */

import { type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';

const WORKBENCH_SELECTOR = '.monaco-workbench';
const WORKBENCH_ATTACHED_TIMEOUT_MS = 60_000;
const WORKBENCH_VISIBLE_TIMEOUT_MS = 60_000;
const DOM_CONTENT_LOADED_TIMEOUT_MS = 30_000;

/**
 * Restores, sizes, shows, and focuses every Electron window. Some VS Code
 * builds open an issue-reporter / shared-process window first; if that
 * window steals the foreground the real workbench window stays hidden and
 * `state: "visible"` waits forever.
 */
async function forceShowAllWindows(app: ElectronApplication): Promise<void> {
    await app
        .evaluate(({ BrowserWindow, screen }) => {
            const { workArea } = screen.getPrimaryDisplay();
            for (const win of BrowserWindow.getAllWindows()) {
                try {
                    if (win.isMinimized()) win.restore();
                    const b = win.getBounds();
                    if (b.width < 100 || b.height < 100) {
                        const w = Math.min(1600, workArea.width);
                        const h = Math.min(1200, workArea.height);
                        win.setBounds({
                            x: workArea.x + Math.max(0, Math.floor((workArea.width - w) / 2)),
                            y: workArea.y + Math.max(0, Math.floor((workArea.height - h) / 2)),
                            width: w,
                            height: h,
                        });
                    }
                    win.show();
                    win.focus();
                } catch {
                    /* window may have been destroyed mid-iteration */
                }
            }
        })
        .catch(() => {
            /* execution context unavailable very early in startup */
        });
}

async function dumpDiagnostics(app: ElectronApplication, page: Page, resultsDir: string): Promise<void> {
    // Inline structural type for what we read off each Electron BrowserWindow.
    // We avoid `import type { BrowserWindow } from 'electron'` because Electron
    // is not a direct dependency of this repo — Playwright pulls it in
    // transitively for `_electron`, but no `.d.ts` is exposed.
    type BrowserWindowLike = {
        getTitle(): string;
        isVisible(): boolean;
        isMinimized(): boolean;
        getBounds(): { x: number; y: number; width: number; height: number };
        webContents: { isCrashed(): boolean; getURL(): string };
    };
    const windows = await app
        .evaluate(({ BrowserWindow }) =>
            (BrowserWindow.getAllWindows() as unknown as BrowserWindowLike[]).map((win) => ({
                title: win.getTitle(),
                isVisible: win.isVisible(),
                isMinimized: win.isMinimized(),
                bounds: win.getBounds(),
                isCrashed: win.webContents.isCrashed(),
                url: win.webContents.getURL(),
            })),
        )
        .catch((e) => `windows-eval-failed: ${(e as Error).message}`);

    const dom = await page
        .evaluate((selector) => {
            const wb = document.querySelector(selector);
            const out: Record<string, unknown> = {
                url: location.href,
                title: document.title,
                htmlW: document.documentElement.clientWidth,
                htmlH: document.documentElement.clientHeight,
            };
            if (wb) {
                const cs = getComputedStyle(wb);
                const r = wb.getBoundingClientRect();
                out.workbench = {
                    display: cs.display,
                    visibility: cs.visibility,
                    opacity: cs.opacity,
                    width: r.width,
                    height: r.height,
                };
            } else {
                out.workbench = null;
            }
            return out;
        }, WORKBENCH_SELECTOR)
        .catch((e) => `dom-eval-failed: ${(e as Error).message}`);

    console.log('[workbenchReady] visible-wait FAILED:\n' + JSON.stringify({ windows, dom }, null, 2));

    try {
        mkdirSync(resultsDir, { recursive: true });
        await page.screenshot({ path: path.join(resultsDir, `workbench-hidden-${Date.now()}.png`), fullPage: true });
    } catch {
        /* screenshot is best-effort */
    }
}

/**
 * Wait until the VS Code workbench is fully ready for interaction.
 *
 * @param resultsDir - Directory under which a diagnostic screenshot is written
 *                     if the workbench fails to become visible.
 */
export async function waitForWorkbenchReady(app: ElectronApplication, page: Page, resultsDir: string): Promise<void> {
    await page.waitForLoadState('domcontentloaded', { timeout: DOM_CONTENT_LOADED_TIMEOUT_MS });

    // Workbench must exist in the DOM before we try to manipulate windows.
    await page.waitForSelector(WORKBENCH_SELECTOR, {
        state: 'attached',
        timeout: WORKBENCH_ATTACHED_TIMEOUT_MS,
    });

    await forceShowAllWindows(app);

    try {
        await page.waitForSelector(WORKBENCH_SELECTOR, {
            state: 'visible',
            timeout: WORKBENCH_VISIBLE_TIMEOUT_MS,
        });
    } catch (err) {
        await dumpDiagnostics(app, page, resultsDir).catch(() => {});
        throw err;
    }

    // Extensions activation banner appears briefly on a fresh profile; wait
    // for it to disappear so it doesn't intercept clicks in the first test.
    await page
        .locator('text="Activating Extensions..."')
        .waitFor({ state: 'hidden', timeout: 30_000 })
        .catch(() => {
            /* may never appear, or disappear too fast to catch */
        });
}
