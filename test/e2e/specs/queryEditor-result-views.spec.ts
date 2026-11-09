/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ResultViewMode, QueryEditorPage } from '../fixtures/queryEditor';
import { expect, test } from '../fixtures/vscode';
import { captureNamedScreenshot, closeAllEditorTabs, maximizeWindow } from '../fixtures/webviewHelpers';
import { attachEmulator } from '../fixtures/webviews';

/**
 * Phase 2 of the Query Editor e2e coverage (see `plans/queryeditor-e2e-plan.md`):
 * the three result view modes. After running the default query, the same seeded
 * document (`prod-00000`) must be visible whether it is rendered as a Table, a
 * Tree, or raw JSON, and switching modes must not emit webview console errors.
 *
 * The view-mode switch is driven through the result-panel "Change view mode"
 * dropdown via the page-object helpers (`setViewMode` / `getActiveViewMode`),
 * which also assert the matching renderer actually mounts.
 *
 * Needs a live, seeded emulator (skipped under `COSMOSDB_E2E_SKIP_EMULATOR=1`).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

/** The deterministic first product of the seed — present on the first result page. */
const SEEDED_ID = 'prod-00000';

const nestedResultQuery = (marker: string) =>
    `SELECT TOP 1 {"objectMarker": "${marker}-object"} AS nestedObject, ` +
    `[{"arrayMarker": "${marker}-array"}] AS nestedArray FROM c`;

async function toggleJsonProperty(qe: QueryEditorPage, property: string): Promise<void> {
    const editor = qe.activeViewContainer('JSON');
    const line = editor.locator('.view-lines .view-line').filter({ hasText: `"${property}"` });
    await expect(line).toBeVisible();
    const top = await line.evaluate((element) => element.getBoundingClientRect().top);
    const controls = editor.locator('.codicon-folding-expanded, .codicon-folding-collapsed');
    const index = await controls.evaluateAll(
        (elements, lineTop) =>
            elements.findIndex((element) => Math.abs(element.getBoundingClientRect().top - lineTop) < 1),
        top,
    );
    expect(index).toBeGreaterThanOrEqual(0);
    await controls.nth(index).click();
}

test.describe('queryEditor-result-views', { tag: '@queryEditor' }, () => {
    test.skip(emulatorSkipped, 'COSMOSDB_E2E_SKIP_EMULATOR=1 — Query Editor tests need a live backend');

    let queryEditor: QueryEditorPage | undefined;

    test.beforeEach(async ({ vscodeApp, vscodeWindow }) => {
        await maximizeWindow(vscodeApp);
        await attachEmulator(vscodeWindow);
        queryEditor = await QueryEditorPage.open(vscodeWindow);
        await queryEditor.waitForConnected();
        // Run the default `SELECT * FROM c` so every view mode has data to render.
        await queryEditor.run();
        await queryEditor.waitForResults(SEEDED_ID);
    });

    test.afterEach(async ({ vscodeWindow }) => {
        await captureNamedScreenshot(vscodeWindow, 'final');
        queryEditor?.dispose();
        queryEditor = undefined;
        await closeAllEditorTabs(vscodeWindow);
    });

    test('defaults to the Table view with the seeded data', async () => {
        const qe = queryEditor!;

        expect(await qe.getActiveViewMode()).toBe('Table');
        await expect(qe.activeViewContainer('Table')).toBeVisible();
        await qe.expectRow(SEEDED_ID);

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('renders the seeded data in Tree, JSON and Table views', async () => {
        const qe = queryEditor!;

        // Cycle away from the default and back, asserting each renderer mounts
        // and still surfaces the same seeded document id.
        const modes: ResultViewMode[] = ['Tree', 'JSON', 'Table'];
        for (const mode of modes) {
            await qe.setViewMode(mode);
            expect(await qe.getActiveViewMode()).toBe(mode);
            await expect(qe.activeViewContainer(mode)).toBeVisible();
            await qe.expectRow(SEEDED_ID);
        }

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('folds nested JSON objects and arrays with the mouse and keyboard without modifying results', async () => {
        const qe = queryEditor!;
        await qe.setQueryText(nestedResultQuery('fold'));
        await qe.run();
        await qe.setViewMode('JSON');

        const editor = qe.activeViewContainer('JSON');
        const lines = editor.locator('.view-lines');
        const objectMarker = lines.locator('.view-line').filter({ hasText: 'fold-object' });
        const arrayMarker = lines.locator('.view-line').filter({ hasText: 'fold-array' });
        await expect(objectMarker).toBeVisible();
        await expect(arrayMarker).toBeVisible();
        const originalText = await lines.innerText();

        const expandedControls = editor.locator('.alwaysShowFoldIcons.codicon-folding-expanded');
        await expect(expandedControls).toHaveCount(5);
        await toggleJsonProperty(qe, 'nestedObject');
        await expect(objectMarker).not.toBeVisible();
        await expect(arrayMarker).toBeVisible();
        await toggleJsonProperty(qe, 'nestedObject');
        await expect(objectMarker).toBeVisible();

        await lines.locator('.view-line').filter({ hasText: '"nestedArray"' }).click();
        const modifier = process.platform === 'darwin' ? 'Meta+Alt' : 'Control+Shift';
        await qe.window.keyboard.press(`${modifier}+BracketLeft`);
        await expect(arrayMarker).not.toBeVisible();
        await expect(objectMarker).toBeVisible();
        await qe.window.keyboard.press(`${modifier}+BracketRight`);
        await expect(arrayMarker).toBeVisible();

        const input = editor.getByRole('textbox', { name: 'Query results JSON' });
        await expect(input).toHaveJSProperty('readOnly', true);
        await input.press('x');
        await expect.poll(() => lines.innerText()).toBe(originalText);
        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('keeps JSON folding usable after view switches and new query results', async () => {
        const qe = queryEditor!;
        await qe.setQueryText(nestedResultQuery('first'));
        await qe.run();
        await qe.setViewMode('JSON');

        const editor = qe.activeViewContainer('JSON');
        const objectMarker = editor.locator('.view-line').filter({ hasText: 'first-object' });
        await expect(objectMarker).toBeVisible();
        await expect(editor.locator('.alwaysShowFoldIcons.codicon-folding-expanded')).toHaveCount(5);
        await toggleJsonProperty(qe, 'nestedObject');
        await expect(objectMarker).not.toBeVisible();

        for (const mode of ['Tree', 'Table'] as const) {
            await qe.setViewMode(mode);
            const results = qe.activeViewContainer(mode);
            if (mode === 'Tree') {
                await results
                    .getByRole('row')
                    .filter({ hasText: 'Document' })
                    .getByRole('button', { name: 'Expand', exact: true })
                    .click();
                await results
                    .getByRole('row')
                    .filter({ hasText: 'nestedObject' })
                    .getByRole('button', { name: 'Expand', exact: true })
                    .click();
            }
            await expect(results.getByRole('gridcell').filter({ hasText: 'first-object' })).toBeVisible();
            await qe.setViewMode('JSON');
            await expect(objectMarker).toBeVisible();
            await expect(editor.locator('.alwaysShowFoldIcons.codicon-folding-expanded')).toHaveCount(5);
            await toggleJsonProperty(qe, 'nestedObject');
            await expect(objectMarker).not.toBeVisible();
        }

        await qe.setQueryText(nestedResultQuery('second'));
        await qe.run();
        const newArrayMarker = editor.locator('.view-line').filter({ hasText: 'second-array' });
        await expect(newArrayMarker).toBeVisible();
        await expect(editor.locator('.alwaysShowFoldIcons.codicon-folding-expanded')).toHaveCount(5);
        await toggleJsonProperty(qe, 'nestedArray');
        await expect(newArrayMarker).not.toBeVisible();
        await toggleJsonProperty(qe, 'nestedArray');
        await expect(newArrayMarker).toBeVisible();
        qe.consoleHealth.assertNoConsoleErrors();
    });
});
