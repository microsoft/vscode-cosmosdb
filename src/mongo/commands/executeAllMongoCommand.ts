/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { executeAllCommandsFromActiveEditor } from '../MongoScrapbook';

export async function executeAllMongoCommand(context: IActionContext): Promise<void> {
    // await loadPersistedMongoDB();
    await executeAllCommandsFromActiveEditor(context);
}
