/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { withProgress } from '../../utils/withProgress';
import { executeAllCommandsFromActiveEditor } from '../MongoScrapbook';
import { MongoScrapbookService } from '../MongoScrapbookService';

export async function executeAllMongoCommand(context: IActionContext): Promise<void> {
    MongoScrapbookService.setExecutingAllCommands(true);
    await withProgress(executeAllCommandsFromActiveEditor(context), 'Executing all Mongo commands in shell...');
    MongoScrapbookService.setExecutingAllCommands(false);
}
