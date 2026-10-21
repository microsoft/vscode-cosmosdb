/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

export async function openMigrationArtifact(filePath: string): Promise<void> {
    const fragmentIndex = filePath.indexOf('#');
    const uri = vscode.Uri.file(fragmentIndex < 0 ? filePath : filePath.slice(0, fragmentIndex));
    if (fragmentIndex < 0) {
        await vscode.window.showTextDocument(uri, { preview: true });
        return;
    }

    const propertyPath = filePath.slice(fragmentIndex + 1);
    let symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>(
        'vscode.executeDocumentSymbolProvider',
        uri,
    );
    let selection: vscode.Range | undefined;
    for (const property of propertyPath.split('.')) {
        const symbol = symbols?.find((candidate) => candidate.name === property);
        if (!symbol) {
            throw new Error(l10n.t('Could not locate JSON property "{property}".', { property: propertyPath }));
        }
        selection = symbol.selectionRange;
        symbols = symbol.children;
    }

    await vscode.window.showTextDocument(uri, { preview: true, selection });
}
