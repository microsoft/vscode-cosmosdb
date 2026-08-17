/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentPanel } from '../fixtures/documentPanel';
import {
    createEmulatorDocument,
    deleteEmulatorDocument,
    emulatorDocumentExists,
    readEmulatorDocument,
    replaceEmulatorDocument,
} from '../fixtures/emulatorDocuments';
import { QueryEditorPage } from '../fixtures/queryEditor';
import { expect, test } from '../fixtures/vscode';
import {
    captureNamedScreenshot,
    closeAllEditorTabs,
    maximizeWindow,
    resetNativeDialogStubs,
    stubMessageBoxButton,
} from '../fixtures/webviewHelpers';
import { attachEmulator } from '../fixtures/webviews';

const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';
const OLD_PARTITION_KEY = 'concurrency-old';
const NEW_PARTITION_KEY = 'concurrency-new';

type ConcurrencyDocument = {
    id: string;
    _partitionKey: string;
    version: number;
    externalChange: string;
    editorChange: string;
};

test.describe('document editor optimistic concurrency', { tag: '@queryEditor' }, () => {
    test.skip(emulatorSkipped, 'COSMOSDB_E2E_SKIP_EMULATOR=1 — document concurrency tests need a live backend');

    let queryEditor: QueryEditorPage | undefined;
    let documentId: string;

    test.beforeEach(async ({ vscodeApp, vscodeWindow }) => {
        documentId = `e2e-concurrency-${Date.now()}`;
        await maximizeWindow(vscodeApp);
        await attachEmulator(vscodeWindow);
        queryEditor = await QueryEditorPage.open(vscodeWindow);
        await queryEditor.waitForConnected();
        await createEmulatorDocument(initialDocument(documentId));
        await queryEditor.run();
        await queryEditor.waitForResults('prod-00000');
    });

    test.afterEach(async ({ vscodeApp, vscodeWindow }) => {
        await captureNamedScreenshot(vscodeWindow, 'final');
        await resetNativeDialogStubs(vscodeApp);
        await deleteEmulatorDocument(documentId, OLD_PARTITION_KEY);
        await deleteEmulatorDocument(documentId, NEW_PARTITION_KEY);
        queryEditor?.dispose();
        queryEditor = undefined;
        await closeAllEditorTabs(vscodeWindow);
    });

    test('discards stale editor changes and refreshes the latest server version', async ({
        vscodeApp,
        vscodeWindow,
    }) => {
        const panel = await openEditableDocument(queryEditor!, vscodeWindow, vscodeApp, documentId);
        const externalVersion = externalDocument(documentId);
        await replaceEmulatorDocument(documentId, OLD_PARTITION_KEY, externalVersion);
        await panel.setContent(JSON.stringify(editorDocument(documentId), null, 2));
        await stubMessageBoxButton(vscodeApp, '^Discard Changes and Refresh$');

        await panel.save();

        await expect.poll(async () => JSON.parse(await panel.getContent())).toMatchObject(externalVersion);
        await expect.poll(() => readEmulatorDocument(documentId, OLD_PARTITION_KEY)).toMatchObject(externalVersion);
        panel.consoleHealth.assertNoConsoleErrors();
        panel.dispose();
    });

    test('overwrites the latest server version only after explicit confirmation', async ({
        vscodeApp,
        vscodeWindow,
    }) => {
        const panel = await openEditableDocument(queryEditor!, vscodeWindow, vscodeApp, documentId);
        await replaceEmulatorDocument(documentId, OLD_PARTITION_KEY, externalDocument(documentId));
        const editorVersion = editorDocument(documentId);
        await panel.setContent(JSON.stringify(editorVersion, null, 2));
        await stubMessageBoxButton(vscodeApp, '^Overwrite$');

        await panel.save();

        await expect.poll(() => readEmulatorDocument(documentId, OLD_PARTITION_KEY)).toMatchObject(editorVersion);
        panel.consoleHealth.assertNoConsoleErrors();
        panel.dispose();
    });

    test('does not move a stale document to a new partition when changes are discarded', async ({
        vscodeApp,
        vscodeWindow,
    }) => {
        const panel = await openEditableDocument(queryEditor!, vscodeWindow, vscodeApp, documentId);
        const externalVersion = externalDocument(documentId);
        await replaceEmulatorDocument(documentId, OLD_PARTITION_KEY, externalVersion);
        await panel.setContent(
            JSON.stringify({ ...editorDocument(documentId), _partitionKey: NEW_PARTITION_KEY }, null, 2),
        );
        await stubMessageBoxButton(vscodeApp, '^Discard Changes and Refresh$');

        await panel.save();

        await expect.poll(async () => JSON.parse(await panel.getContent())).toMatchObject(externalVersion);
        await expect.poll(() => readEmulatorDocument(documentId, OLD_PARTITION_KEY)).toMatchObject(externalVersion);
        await expect.poll(() => emulatorDocumentExists(documentId, NEW_PARTITION_KEY)).toBe(false);
        panel.consoleHealth.assertNoConsoleErrors();
        panel.dispose();
    });
});

async function openEditableDocument(
    queryEditor: QueryEditorPage,
    vscodeWindow: Parameters<typeof QueryEditorPage.open>[0],
    vscodeApp: Parameters<typeof DocumentPanel.attach>[2],
    documentId: string,
): Promise<DocumentPanel> {
    await queryEditor.setQueryText(`SELECT * FROM c WHERE c.id = '${documentId}'`);
    await queryEditor.run();
    await queryEditor.waitForResults(documentId);
    await expect.poll(() => queryEditor.tableRows().count()).toBe(1);
    await queryEditor.invokeSelectionAction(0, 'edit');
    const panel = await DocumentPanel.attach(await queryEditor.waitForDocumentPanel(), vscodeWindow, vscodeApp);
    await panel.expectEditable();
    return panel;
}

function initialDocument(id: string): ConcurrencyDocument {
    return {
        id,
        _partitionKey: OLD_PARTITION_KEY,
        version: 1,
        externalChange: 'original',
        editorChange: 'original',
    };
}

function externalDocument(id: string): ConcurrencyDocument {
    return {
        ...initialDocument(id),
        version: 2,
        externalChange: 'saved outside the editor',
    };
}

function editorDocument(id: string): ConcurrencyDocument {
    return {
        ...initialDocument(id),
        editorChange: 'saved from the stale editor',
    };
}
