/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ScrapbookService } from '../../documentdb/scrapbook/ScrapbookService';
import { withProgress } from '../../utils/withProgress';

export async function executeMongoCommand(context: IActionContext, position?: vscode.Position): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        throw new Error(l10n.t('You must open a *.mongo file to run commands.'));
    }

    const pos = position ?? editor.selection.start;

    await withProgress(
        ScrapbookService.executeCommandAtPosition(context, editor.document, pos),
        l10n.t('Executing Mongo command in shell…'),
    );
}
