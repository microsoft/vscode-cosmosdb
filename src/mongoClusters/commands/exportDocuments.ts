/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import { EJSON } from 'bson';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { appendToFile } from '../../utils/fs/appendToFile';
import { getRootPath } from '../../utils/workspacUtils';
import { MongoClustersClient } from '../MongoClustersClient';
import { type CollectionItem } from '../tree/CollectionItem';

export async function mongoClustersExportDocuments(_context: IActionContext, node?: CollectionItem): Promise<void> {
    // node ??= ... pick a node if not provided
    if (!node) {
        throw new Error('No collection selected.');
    }

    const targetUri = await askForTargetFile(_context);

    if (!targetUri) {
        return;
    }

    const client = await MongoClustersClient.getClient(nonNullValue(node.mongoCluster.session?.credentialId));

    const docStreamAbortController = new AbortController();
    const docStream = client.streamDocuments(
        node.databaseInfo.name,
        node.collectionInfo.name,
        docStreamAbortController.signal,
    );

    const filePath = targetUri.fsPath; // Convert `vscode.Uri` to a regular file path
    ext.outputChannel.appendLog(`MongoDB (vCore): Exporting data to: ${filePath}`);

    let documentCount = 0;

    // Wrap the export process inside a progress reporting function
    await runExportWithProgressAndDescription(node.id, async (progress, cancellationToken) => {
        documentCount = await exportDocumentsToFile(
            docStream,
            filePath,
            progress,
            cancellationToken,
            docStreamAbortController,
        );
    });

    ext.outputChannel.appendLog(`MongoDB (vCore): Exported document count: ${documentCount}`);
}

async function runExportWithProgressAndDescription(
    nodeId: string,
    exportFunction: (
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        cancellationToken: vscode.CancellationToken,
    ) => Promise<void>,
) {
    await ext.state.runWithTemporaryDescription(nodeId, 'Exporting...', async () => {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Exporting documents',
                cancellable: true,
            },
            async (progress, cancellationToken) => {
                try {
                    await exportFunction(progress, cancellationToken);
                } catch (error) {
                    vscode.window.showErrorMessage('Failed to export documents. Please see the output for details.');
                    ext.outputChannel.appendLog(`MongoDB (vCore): Error exporting documents: ${error}`);
                }
                progress.report({ increment: 100 }); // Complete the progress bar
            },
        );
    });
}

async function exportDocumentsToFile(
    documentStream: AsyncGenerator<unknown>,
    filePath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    cancellationToken: vscode.CancellationToken,
    documentStreamAbortController: AbortController,
): Promise<number> {
    const bufferLimit = 1024 * 1024; // ~1 MB buffer limit

    let documentCount = 0;

    try {
        // Start the JSON array
        let buffer = '[\n';

        for await (const doc of documentStream) {
            if (cancellationToken.isCancellationRequested) {
                // Cancel the operation
                documentStreamAbortController.abort();
                await vscode.workspace.fs.delete(vscode.Uri.file(filePath)); // Clean up the file if canceled
                vscode.window.showWarningMessage('The export operation was canceled.');
                return documentCount;
            }

            documentCount += 1;
            const docString = EJSON.stringify(doc, undefined, 4);

            // Progress reporting for every 100 documents
            if (documentCount % 100 === 0) {
                progress.report({ message: `${documentCount} documents exported...` });
            }

            // Prepare buffer for writing
            buffer += buffer.length > 2 ? ',\n' : ''; // Add a comma and newline for non-first documents
            buffer += docString;

            if (buffer.length > bufferLimit) {
                await appendToFile(filePath, buffer);
                buffer = ''; // Clear the buffer after writing
            }
        }

        // Final buffer flush after the loop
        if (buffer.length > 0) {
            await appendToFile(filePath, buffer);
        }

        await appendToFile(filePath, '\n]'); // End the JSON array

        vscode.window.showInformationMessage(`Exported document count: ${documentCount}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Error exporting documents: ${error}`);
        throw error; // Re-throw the error to be caught by the outer error handler
    }

    return documentCount;
}

async function askForTargetFile(_context: IActionContext): Promise<vscode.Uri | undefined> {
    const rootPath: string | undefined = getRootPath();
    let defaultUri: vscode.Uri | undefined;
    if (rootPath) {
        defaultUri = vscode.Uri.joinPath(vscode.Uri.file(rootPath), 'export.json');
    } else {
        defaultUri = vscode.Uri.file('export.json');
    }

    const saveDialogOptions: vscode.SaveDialogOptions = {
        title: 'Where to save the exported documents?',
        saveLabel: 'Export',
        defaultUri: defaultUri,
        filters: {
            'JSON files': ['json'],
        },
    };

    return vscode.window.showSaveDialog(saveDialogOptions);
}
