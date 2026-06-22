/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentPanel } from '../fixtures/documentPanel';
import { QueryEditorPage } from '../fixtures/queryEditor';
import { expect, test } from '../fixtures/vscode';
import {
    captureNamedScreenshot,
    closeActiveEditorTab,
    closeAllEditorTabs,
    maximizeWindow,
    resetNativeDialogStubs,
    stubMessageBoxButton,
} from '../fixtures/webviewHelpers';
import { attachEmulator } from '../fixtures/webviews';

/**
 * Phase 9 of the Query Editor e2e coverage (see `plans/queryeditor-e2e-plan.md`):
 * the full document CRUD round-trip, driven end-to-end against the seeded
 * emulator.
 *
 * The test is **self-contained** so it never pollutes the shared seed data: it
 * creates its OWN document with a unique id, queries for exactly that document,
 * and deletes it again. The verification query (`WHERE c.id = '<unique>'`)
 * isolates the probe from the 200 seeded products.
 *
 * Flow:
 *   1. Run the default query so the edit-mode result toolbar (with the item
 *      actions) renders.
 *   2. **Add** — "Add new item" opens a Document panel in add mode; we replace
 *      its JSON with our probe document and Save.
 *   3. **Query back** — `SELECT * FROM c WHERE c.id = '<id>'` returns exactly the
 *      one probe row.
 *   4. **View** — double-clicking the row opens a read-only Document panel.
 *   5. **Edit** — "Edit selected item" opens an editable Document panel.
 *   6. **Delete** — "Delete selected item" + the native confirmation removes the
 *      document. The grid is NOT auto-refreshed, so the row is still shown
 *      (stale) until the query is re-run.
 *   7. **Re-run** — the same query now returns zero rows, proving the delete and
 *      cleaning up after ourselves.
 *
 * Needs a live, seeded emulator (skipped under `COSMOSDB_E2E_SKIP_EMULATOR=1`).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

/** The deterministic first product of the seed — proves the default query ran. */
const SEEDED_ID = 'prod-00000';

test.describe('queryEditor-crud', { tag: '@queryEditor' }, () => {
    test.skip(emulatorSkipped, 'COSMOSDB_E2E_SKIP_EMULATOR=1 — Query Editor tests need a live backend');

    let queryEditor: QueryEditorPage | undefined;

    test.beforeEach(async ({ vscodeApp, vscodeWindow }) => {
        await maximizeWindow(vscodeApp);
        await attachEmulator(vscodeWindow);
        queryEditor = await QueryEditorPage.open(vscodeWindow);
        await queryEditor.waitForConnected();
        // The default `SELECT * FROM c` is edit mode, so the New / View / Edit /
        // Delete item buttons render in the result toolbar.
        await queryEditor.run();
        await queryEditor.waitForResults(SEEDED_ID);
    });

    test.afterEach(async ({ vscodeApp, vscodeWindow }) => {
        await captureNamedScreenshot(vscodeWindow, 'final');
        await resetNativeDialogStubs(vscodeApp);
        queryEditor?.dispose();
        queryEditor = undefined;
        await closeAllEditorTabs(vscodeWindow);
    });

    test('creates, views, edits and deletes a document end-to-end', async ({ vscodeApp, vscodeWindow }) => {
        const qe = queryEditor!;

        // A unique id per run so a leftover probe from a previously-failed run
        // never collides with this Save (409) — the container has no volume so
        // it's normally pristine, but be defensive.
        const docId = `e2e-crud-${Date.now()}`;
        const probe = JSON.stringify(
            { id: docId, name: 'E2E CRUD probe', category: 'E2E', _partitionKey: 'e2e-test' },
            null,
            2,
        );
        const fetchById = `SELECT * FROM c WHERE c.id = '${docId}'`;

        // ── Add ───────────────────────────────────────────────────────────────
        await qe.addNewItem();
        const addPanel = await DocumentPanel.attach(await qe.waitForDocumentPanel(), vscodeWindow, vscodeApp);
        await addPanel.expectEditable();
        await addPanel.setContent(probe);
        await addPanel.save();
        addPanel.consoleHealth.assertNoConsoleErrors();
        addPanel.dispose();
        await closeActiveEditorTab(vscodeWindow);

        // ── Query back: exactly our one probe document ─────────────────────────
        await qe.setQueryText(fetchById);
        await qe.run();
        await qe.waitForResults(docId);
        await expect.poll(() => qe.tableRows().count()).toBe(1);

        // ── View (read-only) ───────────────────────────────────────────────────
        await qe.doubleClickRow(0);
        const viewPanel = await DocumentPanel.attach(await qe.waitForDocumentPanel(), vscodeWindow, vscodeApp);
        await viewPanel.expectReadOnly();
        expect(await viewPanel.frame.getByText(docId).count()).toBeGreaterThan(0);
        viewPanel.consoleHealth.assertNoConsoleErrors();
        viewPanel.dispose();
        await closeActiveEditorTab(vscodeWindow);

        // ── Edit (editable) ────────────────────────────────────────────────────
        await qe.invokeSelectionAction(0, 'edit');
        const editPanel = await DocumentPanel.attach(await qe.waitForDocumentPanel(), vscodeWindow, vscodeApp);
        await editPanel.expectEditable();
        editPanel.consoleHealth.assertNoConsoleErrors();
        editPanel.dispose();
        await closeActiveEditorTab(vscodeWindow);

        // ── Delete (confirmed via the native modal) ────────────────────────────
        await stubMessageBoxButton(vscodeApp, 'Yes');
        await qe.invokeSelectionAction(0, 'delete');

        // The result grid is not refreshed by a delete, so the row is still
        // shown (stale) until the query is re-run.
        await expect(qe.tableRows()).toHaveCount(1);

        // ── Re-run: the document is gone, confirming the delete + cleanup ──────
        await qe.run();
        await expect.poll(() => qe.tableRows().count(), { timeout: 15_000 }).toBe(0);
        // The id still appears in the query text, so scope the "gone" assertion
        // to the result grid rather than the whole frame.
        await expect(qe.resultRegion().getByText(docId)).toHaveCount(0);

        qe.consoleHealth.assertNoConsoleErrors();
    });
});
