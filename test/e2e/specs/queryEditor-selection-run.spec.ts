/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryEditorPage } from '../fixtures/queryEditor';
import { expect, test } from '../fixtures/vscode';
import { captureNamedScreenshot, closeAllEditorTabs, maximizeWindow } from '../fixtures/webviewHelpers';
import { attachEmulator } from '../fixtures/webviews';

/**
 * Phase 10 of the Query Editor e2e coverage (see `plans/queryeditor-e2e-plan.md`):
 * running only the **selected** query fragment.
 *
 * The editor tracks the Monaco text selection into `querySelectedValue`, and Run
 * executes that selection in preference to the full editor text. The editor is
 * loaded with two distinct single-row queries on separate lines; selecting one
 * line and running must return that line's row only — not the other's.
 *
 * Needs a live, seeded emulator (skipped under `COSMOSDB_E2E_SKIP_EMULATOR=1`).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

const ID_ONE = 'prod-00001';
const ID_TWO = 'prod-00002';
const TWO_QUERIES = `SELECT c.id FROM c WHERE c.id = '${ID_ONE}'\nSELECT c.id FROM c WHERE c.id = '${ID_TWO}'`;

test.describe('queryEditor-selection-run', { tag: '@queryEditor' }, () => {
    test.skip(emulatorSkipped, 'COSMOSDB_E2E_SKIP_EMULATOR=1 — Query Editor tests need a live backend');

    let queryEditor: QueryEditorPage | undefined;

    test.beforeEach(async ({ vscodeApp, vscodeWindow }) => {
        await maximizeWindow(vscodeApp);
        await attachEmulator(vscodeWindow);
        queryEditor = await QueryEditorPage.open(vscodeWindow);
        await queryEditor.waitForConnected();
        await queryEditor.setQueryText(TWO_QUERIES);
    });

    test.afterEach(async ({ vscodeWindow }) => {
        await captureNamedScreenshot(vscodeWindow, 'final');
        queryEditor?.dispose();
        queryEditor = undefined;
        await closeAllEditorTabs(vscodeWindow);
    });

    test('runs only the selected query fragment', async () => {
        const qe = queryEditor!;

        // Select + run the first line → only prod-00001 comes back.
        await qe.selectQueryLine(0);
        await qe.run();
        await qe.waitForResults(ID_ONE);
        await expect.poll(() => qe.tableRows().count()).toBe(1);
        await expect(qe.resultRegion().getByText(ID_TWO)).toHaveCount(0);

        // Select + run the second line → the result flips to prod-00002 only.
        await qe.selectQueryLine(1);
        await qe.run();
        await qe.waitForResults(ID_TWO);
        await expect.poll(() => qe.tableRows().count()).toBe(1);
        await expect(qe.resultRegion().getByText(ID_ONE)).toHaveCount(0);

        qe.consoleHealth.assertNoConsoleErrors();
    });
});
