/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { getRootPath } from '../../utils/workspacUtils';
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

    await node.exportDocuments(_context, targetUri);
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
