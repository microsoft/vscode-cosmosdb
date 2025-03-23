/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ScrapbookService } from '../../documentdb/scrapbook/ScrapbookService';
import { withProgress } from '../../utils/withProgress';

export async function executeAllMongoCommand(context: IActionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        throw new Error(l10n.t('You must open a *.mongo file to run commands.'));
    }
    await withProgress(
        ScrapbookService.executeAllCommands(context, editor.document),
        l10n.t('Executing all Mongo commands in shell…'),
    );
}
