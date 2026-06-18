/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Helpers for driving the VS Code command palette and accessing webview
 * iframes from Playwright e2e tests. Adapted (and trimmed) from the sibling
 * `vs-code-postgresql` project's `helpers/webviewHelpers.ts`.
 *
 * Webview iframe structure VS Code uses for extension panels:
 *
 *   <iframe class="webview ready" src="vscode-webview://…">     ← outer chrome
 *     <iframe id="active-frame" src="vscode-webview://…">       ← extension content
 *       <html><body><div id="root">…React app…</div></body></html>
 *     </iframe>
 *   </iframe>
 *
 * The outer iframe carries no useful identifying attributes in recent VS
 * Code builds (no aria-label, no title), so instead of selector-chaining we
 * iterate `page.frames()` and ask each candidate to prove it's the right
 * one via a user-supplied `isReady` predicate. This doubles as a wait for
 * the webview to be fully populated (React mounted, expected UI present).
 */

import { test, type Frame, type Page } from '@playwright/test';

const COMMAND_PALETTE_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P';
const QUICK_INPUT_SELECTOR = '.quick-input-widget input';
const TAB_SELECTOR = 'div[role="tab"]';
const WEBVIEW_FRAME_TIMEOUT_MS = 30_000;
const WEBVIEW_POLL_INTERVAL_MS = 250;

/** Frames whose parent is non-null = nested = webview content frames. */
function getWebviewFrames(page: Page): Frame[] {
    return page.frames().filter((f) => f.parentFrame() !== null);
}

async function frameMatchesReady(frame: Frame, isReady: (f: Frame) => Promise<boolean>): Promise<boolean> {
    try {
        return await isReady(frame);
    } catch {
        return false;
    }
}

/**
 * Opens the command palette and runs a command by its visible title.
 *
 * `commandTitle` should match what the palette displays — e.g.
 * `"Cosmos DB: New Migration…"`. Substring matching is fine: we type the
 * title verbatim and press Enter, which selects the top-ranked result.
 */
export async function runCommand(page: Page, commandTitle: string): Promise<void> {
    await page.keyboard.press(COMMAND_PALETTE_SHORTCUT);
    const input = page.locator(QUICK_INPUT_SELECTOR).first();
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    // The leading ">" forces "command" mode regardless of where the palette
    // was last left (quick-open vs. commands).
    await input.fill(`>${commandTitle}`);
    // Wait for the first result row so we don't press Enter before the list
    // populates (which would just close the palette).
    await page.locator('.quick-input-list .monaco-list-row').first().waitFor({ state: 'visible', timeout: 5_000 });
    await page.keyboard.press('Enter');
}

/**
 * Returns the Playwright {@link Frame} of a webview's content iframe.
 *
 * The function iterates every nested frame in the page until `isReady`
 * returns true for one of them. `isReady` should assert something
 * specific to the target webview — e.g. that a header / button is
 * rendered — so the function doubles as a "wait until the React app has
 * mounted" check.
 *
 *     const webview = await getWebviewByPredicate(
 *         vsCodeWindow,
 *         async (frame) => (await frame.locator('#root > *').count()) > 0,
 *     );
 *     await expect(webview.locator('#root')).toBeVisible();
 */
export async function getWebviewByPredicate(
    page: Page,
    isReady: (frame: Frame) => Promise<boolean>,
    timeoutMs: number = WEBVIEW_FRAME_TIMEOUT_MS,
): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    let lastSeenFrameUrls: string[] = [];

    while (Date.now() < deadline) {
        // Iterate newest frames first — webview panels created last are the
        // most likely candidates for the current test step.
        const frames = [...getWebviewFrames(page)].reverse();
        lastSeenFrameUrls = frames.map((f) => f.url());
        for (const frame of frames) {
            if (await frameMatchesReady(frame, isReady)) return frame;
        }
        await page.waitForTimeout(WEBVIEW_POLL_INTERVAL_MS);
    }

    const tabs = await page
        .locator(TAB_SELECTOR)
        .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent ?? '').filter(Boolean));
    throw new Error(
        `Webview matching predicate not found within ${timeoutMs} ms.\n` +
            `Open tabs: [${tabs.join(' | ')}]\n` +
            `Webview frame URLs: [${lastSeenFrameUrls.join(' | ')}]`,
    );
}

/**
 * Captures a screenshot of the whole VS Code window and attaches it to the
 * current test, so it appears in the HTML report and is written under the
 * results dir.
 *
 * Capture is controlled by `COSMOSDB_E2E_SCREENSHOT`, mirroring Playwright's
 * `screenshot` option:
 *   - `on` / `1`             — capture for every test (pass or fail)
 *   - `off` / `0`            — never capture
 *   - `only-on-failure`      — capture only when the test failed
 *   - unset / any other      — same as `only-on-failure` (the default)
 *
 * Why explicit capture? Playwright's declarative `use.screenshot` only covers
 * the browser `page` it manages. Our tests drive a custom Electron window via
 * `_electron.launch`, which that machinery doesn't touch (no PNG is ever
 * produced — even on failure), so we capture it ourselves.
 */
export async function captureWindowScreenshot(page: Page, name = 'vscode-window'): Promise<void> {
    if (page.isClosed()) return;

    let info: ReturnType<typeof test.info>;
    try {
        info = test.info();
    } catch {
        // Not running inside a test (e.g. called from a non-test context).
        return;
    }

    const raw = (process.env.COSMOSDB_E2E_SCREENSHOT ?? '').trim().toLowerCase();
    const mode = raw === 'on' || raw === '1' ? 'on' : raw === 'off' || raw === '0' ? 'off' : 'only-on-failure';
    const shouldCapture = mode === 'on' || (mode === 'only-on-failure' && info.status !== info.expectedStatus);
    if (!shouldCapture) return;

    try {
        // Wrap the capture in a named `test.step` so the underlying
        // `Page.screenshot` call surfaces as a labeled action in the trace's
        // Actions list (the main trace/watch screen, not just the Attachments
        // tab). Selecting that action renders the PNG in the center snapshot
        // pane. The `path` attachment additionally exposes it in Attachments.
        await test.step(`📸 ${name}`, async () => {
            const file = info.outputPath(`${name}.png`);
            await page.screenshot({ path: file });
            await info.attach(`${name} (${info.title})`, { path: file, contentType: 'image/png' });
        });
    } catch {
        // Best-effort — never fail a test on screenshot capture.
    }
}

/**
 * Close every editor tab via the `workbench.action.revertAndCloseActiveEditor`
 * command. Required between tests when the VS Code instance is shared across
 * a worker (see the worker-scoped `vscodeApp` fixture) — otherwise webview
 * panels opened by one test leak into the next.
 */
export async function closeAllEditorTabs(page: Page): Promise<void> {
    if (page.isClosed()) return;

    // Capture the final webview state before the tabs are closed (when enabled).
    await captureWindowScreenshot(page);

    try {
        // Dismiss any popover / menu that might intercept the palette shortcut.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);

        const input = page.locator(QUICK_INPUT_SELECTOR).first();

        for (let attempt = 0; attempt < 15; attempt++) {
            const tabCount = await page.locator(TAB_SELECTOR).count();
            if (tabCount === 0) return;

            await page.keyboard.press(COMMAND_PALETTE_SHORTCUT);
            try {
                await input.waitFor({ state: 'visible', timeout: 2_000 });
                await input.fill('>workbench.action.revertAndCloseActiveEditor');
                await page.waitForTimeout(150);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(300);
            } catch {
                // Quick-input didn't open this iteration — dismiss + retry.
                await page.keyboard.press('Escape');
                await page.waitForTimeout(300);
            }
        }
    } catch {
        // Best-effort cleanup — never fail a test on cleanup.
    }
}
