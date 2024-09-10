/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { executeAllCommandsFromActiveEditor } from '../MongoScrapbook';
import { loadPersistedMongoDB } from './connectMongoDatabase';

export async function executeAllMongoCommand(context: IActionContext) {
    await loadPersistedMongoDB();
    await executeAllCommandsFromActiveEditor(context);
}
