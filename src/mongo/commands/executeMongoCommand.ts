/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';
import { withProgress } from '../../utils/withProgress';
import { executeCommandFromActiveEditor } from '../MongoScrapbook';

export async function executeMongoCommand(context: IActionContext, position?: vscode.Position): Promise<void> {
    await (withProgress(executeCommandFromActiveEditor(context, position), 'Executing Mongo command in shell...'));
}
