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
 * Opens a top-level toolbar trigger and leaves its menu open, transparently
 * handling the toolbar's responsive collapse.
 *
 * `toolbarName` is the trigger's inline accessible name (which may come from
 * `aria-label` rather than visible text — e.g. Learn is exposed as "Learn
 * more"). `overflowText` is the visible label the same control shows once it has
 * collapsed into the "More items" overflow menu (e.g. "Learn"): submenu triggers
 * inside that menu are not reliably matched by the `menuitem` role in Fluent, so
 * the overflow side is matched by visible text — mirroring the page object in
 * `fixtures/queryEditor.ts`.
 *
 * The toolbar (`role="toolbar"`) mounts asynchronously once the initial tRPC
 * state arrives, and it is width-responsive: the target trigger is either inline
 * OR under the overflow menu. We wait until one of those has settled, then act —
 * so we neither race the render nor (as before) silently fall through without
 * clicking, which would surface later as a confusing locator error on the menu
 * assertions.
 */
async function openToolbarMenu(
    webview: Frame,
    { toolbarName, overflowText }: { toolbarName: string; overflowText: string },
): Promise<undefined> {
    const toolbar = webview.getByRole('toolbar').first();
    await toolbar.waitFor({ state: 'visible', timeout: 30_000 });

    // Scope button lookups to the query toolbar so we don't collide with the
    // Result Panel toolbar, which also has its own "More items" overflow
    // button and can trigger strict-mode locator errors.
    const directButton = toolbar.getByRole('button', { name: toolbarName, exact: true }).first();
    const moreItems = toolbar.getByRole('button', { name: 'More items' }).first();

    // Wait until the toolbar has settled into one of its two layouts: the
    // trigger is inline, or it has collapsed and the overflow trigger is present.
    await expect
        .poll(
            async () =>
                (await directButton.isVisible().catch(() => false)) || (await moreItems.isVisible().catch(() => false)),
            { timeout: 30_000 },
        )
        .toBe(true);

    // Inline: click the toolbar trigger directly.
    if (await directButton.isVisible().catch(() => false)) {
        await directButton.click();
        return;
    }

    // Collapsed: open the overflow menu and activate the entry by its visible
    // text. A missing overflow trigger here fails loudly (via the click's
    // actionability timeout) rather than leaving the caller with no menu open.
    await moreItems.click();
    const overflowMenu = webview.getByRole('menu').first();
    await overflowMenu.waitFor({ state: 'visible', timeout: 5_000 });
    await overflowMenu.getByText(overflowText, { exact: true }).first().click();
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

        await openToolbarMenu(webview, { toolbarName: 'AI (Preview)', overflowText: 'AI (Preview)' });

        await expect(webview.getByRole('menuitem', { name: 'Generate query', exact: true })).toBeVisible();
        await expect(webview.getByRole('menuitem', { name: 'Explain query', exact: true })).toBeVisible();
        await expect(webview.getByRole('menuitem', { name: 'Help', exact: true })).toBeVisible();
    });

    test('Learn button dropdown shows navigable documentation links', async ({ vscodeWindow }) => {
        const webview = await openQueryEditor(vscodeWindow);
        await expect(webview.locator('#root')).toBeVisible();
        await openToolbarMenu(webview, { toolbarName: 'Learn more', overflowText: 'Learn' });

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
