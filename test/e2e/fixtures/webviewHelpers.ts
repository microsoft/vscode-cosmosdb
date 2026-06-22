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

import { test, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import { resolveCapturePlan, shouldCapture } from '../helpers/captureMode';

const COMMAND_PALETTE_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P';
const QUICK_INPUT_SELECTOR = '.quick-input-widget input';
const TAB_SELECTOR = 'div[role="tab"]';
const WEBVIEW_FRAME_TIMEOUT_MS = 30_000;
const WEBVIEW_POLL_INTERVAL_MS = 250;

/**
 * Maximizes (and enlarges) the VS Code window so webview toolbars render all of
 * their controls inline instead of collapsing into a Fluent UI "More items"
 * overflow menu. Several Query Editor specs assert on toolbar buttons directly;
 * a wide, deterministic window removes overflow-driven flakiness. Best-effort —
 * never throws.
 */
export async function maximizeWindow(app: ElectronApplication): Promise<void> {
    await app
        .evaluate(({ BrowserWindow }) => {
            const [win] = BrowserWindow.getAllWindows();
            if (!win) {
                return;
            }
            win.setBounds({ x: 0, y: 0, width: 1920, height: 1200 });
            win.maximize();
        })
        .catch(() => {
            /* No window yet / context torn down — callers tolerate this. */
        });
}

/**
 * Resizes the VS Code window to an explicit width/height (un-maximizing first
 * if needed). Use this to make the editor area — and therefore a webview's
 * toolbar — narrow enough to force Fluent UI's `Overflow` to collapse controls
 * into the "More items" menu. Best-effort — never throws.
 */
export async function resizeWindow(app: ElectronApplication, width: number, height: number): Promise<void> {
    await app
        .evaluate(
            ({ BrowserWindow }, bounds) => {
                const [win] = BrowserWindow.getAllWindows();
                if (!win) {
                    return;
                }
                if (win.isMaximized()) {
                    win.unmaximize();
                }
                win.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
            },
            { width, height },
        )
        .catch(() => {
            /* No window yet / context torn down — callers tolerate this. */
        });
}

/**
 * Overrides the native Electron message-box (used by VS Code modal
 * `showWarningMessage`/`showInformationMessage` prompts when the default
 * `window.dialogStyle: 'native'` is in effect) so a test can deterministically
 * "click" a specific button without a real, non-interactable OS dialog.
 *
 * `buttonLabelPattern` is a case-insensitive RegExp source matched against the
 * dialog's button labels; the first matching button's index is returned as the
 * response (falling back to 0 when nothing matches). Restore the fixture's
 * default with {@link resetNativeDialogStubs} afterwards (the Electron app is
 * worker-scoped, so the override otherwise leaks into later tests).
 */
export async function stubMessageBoxButton(app: ElectronApplication, buttonLabelPattern: string): Promise<void> {
    await app.evaluate(({ dialog }, pattern) => {
        const re = new RegExp(pattern, 'i');
        // VS Code calls dialog.showMessageBox either as (window, options) or
        // (options); pick whichever argument carries the `buttons` array.
        dialog.showMessageBox = ((...args: unknown[]) => {
            const opts = (args.length > 1 ? args[1] : args[0]) as { buttons?: string[] } | undefined;
            const buttons = opts?.buttons ?? [];
            const index = buttons.findIndex((label) => re.test(label));
            return Promise.resolve({ response: index >= 0 ? index : 0, checkboxChecked: false });
        }) as typeof dialog.showMessageBox;
    }, buttonLabelPattern);
}

/**
 * Restores the native dialog stubs to the fixture defaults (cancel/decline
 * everything). Mirrors `disableNativeDialogs` in `vscode.ts`; call this in a
 * test's cleanup after {@link stubMessageBoxButton}.
 */
export async function resetNativeDialogStubs(app: ElectronApplication): Promise<void> {
    await app
        .evaluate(({ dialog }) => {
            dialog.showSaveDialog = () => Promise.resolve({ canceled: true, filePath: '' });
            dialog.showOpenDialog = () => Promise.resolve({ canceled: true, filePaths: [] });
            dialog.showMessageBoxSync = () => 1;
            dialog.showMessageBox = () => Promise.resolve({ response: 1, checkboxChecked: false });
        })
        .catch(() => {
            /* Context may be torn down during teardown — tolerate. */
        });
}

/**
 * Closes the auxiliary (secondary) side bar — where a fresh VS Code profile may
 * auto-open the Chat view. Leaving it open steals horizontal space from the
 * editor area and squeezes webviews under test. Best-effort — never throws.
 */
export async function closeAuxiliaryBar(page: Page): Promise<void> {
    if (page.isClosed()) {
        return;
    }
    try {
        await runCommand(page, 'workbench.action.closeAuxiliaryBar');
    } catch {
        // The command may be unavailable (older builds) or the bar already
        // closed — either way there's nothing to clean up.
    }
}

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
 * Capture is controlled by `COSMOSDB_E2E_SCREENSHOT` (see
 * `helpers/captureMode.ts` for the full mode table). In short: `on`/`1`
 * captures every test, `off`/`0` never, and the default captures only on
 * failure.
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

    const { screenshot } = resolveCapturePlan();
    const failed = info.status !== info.expectedStatus;
    if (!shouldCapture(screenshot, failed)) return;

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
 * Captures a screenshot of the whole VS Code window to a file named after the
 * current test (plus a `label` such as `loaded` / `final`), attaches it to the
 * HTML report, and writes it under the per-test results directory.
 *
 * Unlike {@link captureWindowScreenshot} (which honours the only-on-failure
 * default), this fires for *every* test so you can eyeball what each test
 * actually rendered — useful while building out coverage. It is suppressed only
 * when `COSMOSDB_E2E_SCREENSHOT=off`. Best-effort: never fails a test.
 */
export async function captureNamedScreenshot(page: Page, label: string): Promise<void> {
    if (page.isClosed()) return;

    let info: ReturnType<typeof test.info>;
    try {
        info = test.info();
    } catch {
        // Not running inside a test (e.g. called from a non-test context).
        return;
    }

    if (resolveCapturePlan().screenshot === 'off') return;

    const slug = (value: string, max: number): string =>
        value
            .trim()
            .replace(/[^a-z0-9-_]+/gi, '-')
            .replace(/(^-+|-+$)/g, '')
            .toLowerCase()
            .slice(0, max) || 'shot';

    try {
        await test.step(`📸 ${label}`, async () => {
            const file = info.outputPath(`${slug(info.title, 60)}-${slug(label, 20)}.png`);
            await page.screenshot({ path: file });
            await info.attach(`${label} (${info.title})`, { path: file, contentType: 'image/png' });
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

/**
 * Closes only the *active* editor tab via
 * `workbench.action.revertAndCloseActiveEditor`, reverting any unsaved changes
 * so no save prompt blocks the test. Use this to dismiss a Document panel that a
 * Query Editor drill-in (New / View / Edit item) opened while keeping the Query
 * Editor tab itself open. Returns once the tab count has dropped (or after a
 * best-effort timeout).
 */
export async function closeActiveEditorTab(page: Page): Promise<void> {
    if (page.isClosed()) return;

    const before = await page.locator(TAB_SELECTOR).count();
    if (before === 0) return;

    try {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);

        const input = page.locator(QUICK_INPUT_SELECTOR).first();
        await page.keyboard.press(COMMAND_PALETTE_SHORTCUT);
        await input.waitFor({ state: 'visible', timeout: 2_000 });
        await input.fill('>workbench.action.revertAndCloseActiveEditor');
        await page.waitForTimeout(150);
        await page.keyboard.press('Enter');

        // Wait for the tab count to actually drop so callers can rely on the
        // previous editor regaining focus.
        for (let attempt = 0; attempt < 20; attempt++) {
            if ((await page.locator(TAB_SELECTOR).count()) < before) return;
            await page.waitForTimeout(150);
        }
    } catch {
        // Best-effort — never fail a test on cleanup.
    }
}
