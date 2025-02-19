/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { withProgress } from '../../utils/withProgress';
import { MongoScrapbookService } from '../MongoScrapbookService';

export async function executeMongoCommand(context: IActionContext, position?: vscode.Position): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        throw new Error('You must open a *.mongo file to run commands.');
    }

    const pos = position ?? editor.selection.start;

    await withProgress(
        MongoScrapbookService.executeCommandAtPosition(context, editor.document, pos),
        'Executing Mongo command in shell...',
    );
}
