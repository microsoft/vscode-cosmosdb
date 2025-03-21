/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext, parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { EJSON } from 'bson';
import * as vscode from 'vscode';
import { MongoClustersClient } from '../../documentdb/MongoClustersClient';
import { ext } from '../../extensionVariables';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { appendToFile } from '../../utils/fs/appendToFile';
import { getRootPath } from '../../utils/workspacUtils';

export async function mongoClustersExportEntireCollection(context: IActionContext, node?: CollectionItem) {
    context.telemetry.properties.experience = node?.mongoCluster.dbExperience?.api;

    return mongoClustersExportQueryResults(context, node);
}

export async function mongoClustersExportQueryResults(
    context: IActionContext,
    node?: CollectionItem,
    props?: { queryText?: string; source?: string },
): Promise<void> {
    context.telemetry.properties.experience = node?.mongoCluster.dbExperience?.api;

    // node ??= ... pick a node if not provided
    if (!node) {
        throw new Error(l10n.t('No collection selected.'));
    }

    context.telemetry.properties.calledFrom = props?.source || 'contextMenu';

    const targetUri = await askForTargetFile(context);

    if (!targetUri) {
        return;
    }

    const client = await MongoClustersClient.getClient(node.mongoCluster.id);

    const docStreamAbortController = new AbortController();
    const docStream = client.streamDocuments(
        node.databaseInfo.name,
        node.collectionInfo.name,
        docStreamAbortController.signal,
        props?.queryText,
    );

    const filePath = targetUri.fsPath; // Convert `vscode.Uri` to a regular file path
    ext.outputChannel.appendLog(l10n.t('MongoDB Clusters: Exporting data to: {filePath}', { filePath }));

    let documentCount = 0;

    // Wrap the export process inside a progress reporting function
    await callWithTelemetryAndErrorHandling('cosmosDB.mongoClusters.exportDocuments', async (actionContext) => {
        await runExportWithProgressAndDescription(node.id, async (progress, cancellationToken) => {
            documentCount = await exportDocumentsToFile(
                docStream,
                filePath,
                progress,
                cancellationToken,
                docStreamAbortController,
            );
        });

        actionContext.telemetry.properties.source = props?.source;
        actionContext.telemetry.measurements.queryLength = props?.queryText?.length;
        actionContext.telemetry.measurements.documentCount = documentCount;
    });

    ext.outputChannel.appendLog(
        l10n.t('MongoDB Clusters: Exported document count: {documentCount}', { documentCount }),
    );
}

async function runExportWithProgressAndDescription(
    nodeId: string,
    exportFunction: (
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        cancellationToken: vscode.CancellationToken,
    ) => Promise<void>,
) {
    await ext.state.runWithTemporaryDescription(nodeId, l10n.t('Exporting…'), async () => {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: l10n.t('Exporting documents'),
                cancellable: true,
            },
            async (progress, cancellationToken) => {
                try {
                    await exportFunction(progress, cancellationToken);
                } catch (error) {
                    vscode.window.showErrorMessage(
                        l10n.t('Failed to export documents. Please see the output for details.'),
                    );
                    ext.outputChannel.appendLog(
                        l10n.t('MongoDB Clusters: Error exporting documents: {error}', {
                            error: parseError(error).message,
                        }),
                    );
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
                vscode.window.showWarningMessage(l10n.t('The export operation was canceled.'));
                return documentCount;
            }

            documentCount += 1;
            const docString = EJSON.stringify(doc, undefined, 4);

            // Progress reporting for every 100 documents
            if (documentCount % 100 === 0) {
                progress.report({ message: l10n.t('{documentCount} documents exported…', { documentCount }) });
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

        vscode.window.showInformationMessage(l10n.t('Exported document count: {documentCount}', { documentCount }));
    } catch (error) {
        vscode.window.showErrorMessage(
            l10n.t('Error exporting documents: {error}', { error: parseError(error).message }),
        );
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
        title: l10n.t('Where to save the exported documents?'),
        saveLabel: l10n.t('Export'),
        defaultUri: defaultUri,
        filters: {
            'JSON files': ['json'],
        },
    };

    return vscode.window.showSaveDialog(saveDialogOptions);
}
