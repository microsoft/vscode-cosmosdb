/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Frame } from '@playwright/test';
import { expect, test } from '../fixtures/vscode';
import { closeAllEditorTabs } from '../fixtures/webviewHelpers';
import { openQueryEditor, setAIFeaturesEnabled } from '../fixtures/webviews';

/**
 * Toolbar coverage for the Query Editor webview
 * (`src/webviews/cosmosdb/QueryEditor/QueryPanel/`).
 *
 * What we assert:
 *   1. The AI button's dropdown lists the expected actions — Generate query,
 *      Explain query, and Help (see `AIButton.tsx`). The AI button only
 *      renders when AI features are enabled, so we force the flag on with the
 *      `cosmosDB.e2e.setAIFeaturesEnabled` test-only command first.
 *   2. The Learn button's dropdown exposes navigable documentation links —
 *      they render as `<a role="menuitem">` elements with `https` hrefs (see
 *      `LearnButton.tsx`). We assert the links are present and well-formed
 *      rather than mirroring the exact URLs, which would only duplicate the
 *      component's literals without catching real bugs.
 *
 * Neither test needs the emulator — the Query Editor mounts (and its toolbar
 * renders from local state) without a live backend, exactly like the smoke
 * suite. So this spec runs in both `npm run e2e` and skip-emulator modes.
 */

/**
 * The number of documentation links rendered by `LearnButton`. Bumped
 * deliberately when links are added or removed so an accidental deletion is
 * caught, without coupling the test to specific URLs.
 */
const EXPECTED_LEARN_LINK_COUNT = 5;

/**
 * Opens a top-level toolbar button by its accessible name and leaves that
 * button's menu open.
 *
 * `accessibleName` is the button's accessible name, which can come from
 * `aria-label` rather than visible text. For example, the overflow trigger is
 * exposed as "More items" and the Learn trigger is exposed as "Learn more".
 *
 * The toolbar (`role="toolbar"`) renders asynchronously once the initial tRPC
 * state arrives, so we wait for it as a "toolbar ready" sentinel and then
 * poll for the target button before clicking. The poll avoids racing the
 * render while the toolbar is still mounting.
 */
async function openToolbarMenu(webview: Frame, accessibleName: string): Promise<undefined> {
    const toolbar = webview.getByRole('toolbar').first();
    await toolbar.waitFor({ state: 'visible', timeout: 30_000 });

    // Scope button lookups to the query toolbar so we don't collide with the
    // Result Panel toolbar, which also has its own "More items" overflow
    // button and can trigger strict-mode locator errors.
    const directButton = toolbar.getByRole('button', { name: accessibleName, exact: true }).first();

    // Wait until the toolbar button is actually mounted before clicking it.
    await expect
        .poll(async () => directButton.isVisible().catch(() => false), {
            timeout: 30_000,
        })
        .toBe(true);

    if (await directButton.isVisible()) {
        await directButton.click();
        return;
    }
}

test.describe('query editor toolbar', () => {
    test.afterEach(async ({ vscodeWindow }) => {
        // A test may end (pass or fail) with a toolbar menu still open. Press
        // Escape to dismiss it so it can't leak into the next test or swallow
        // the command-palette shortcut used by `closeAllEditorTabs`.
        await vscodeWindow.keyboard.press('Escape');
        await vscodeWindow.waitForTimeout(150);
        await closeAllEditorTabs(vscodeWindow);
    });

    test('AI button dropdown lists expected items', async ({ vscodeWindow }) => {
        // Force AI features on BEFORE opening so the initial state renders the
        // AI button (it's hidden when Copilot isn't available).
        await setAIFeaturesEnabled(vscodeWindow);

        const webview = await openQueryEditor(vscodeWindow);
        await expect(webview.locator('#root')).toBeVisible();

        await openToolbarMenu(webview, 'AI');

        await expect(webview.getByRole('menuitem', { name: 'Generate query', exact: true })).toBeVisible();
        await expect(webview.getByRole('menuitem', { name: 'Explain query', exact: true })).toBeVisible();
        await expect(webview.getByRole('menuitem', { name: 'Help', exact: true })).toBeVisible();
    });

    test('Learn button dropdown shows navigable documentation links', async ({ vscodeWindow }) => {
        const webview = await openQueryEditor(vscodeWindow);
        await expect(webview.locator('#root')).toBeVisible();
        await openToolbarMenu(webview, 'Learn more');

        // Documentation entries render as <a role="menuitem"> with an href. We
        // assert they're present and point at real https URLs rather than
        // mirroring the exact links from the component.
        const docLinks = webview.locator('a[role="menuitem"][href]');
        await expect(docLinks).toHaveCount(EXPECTED_LEARN_LINK_COUNT);

        const count = await docLinks.count();
        await Promise.all(
            Array.from({ length: count }, (_, i) => expect(docLinks.nth(i)).toHaveAttribute('href', /^https:\/\/.+/)),
        );
    });
});
