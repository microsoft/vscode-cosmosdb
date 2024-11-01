/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { getConfirmationWithWordQuestion } from '../../utils/dialogsConfirmations';
import { type DatabaseItem } from '../tree/DatabaseItem';

export async function dropDatabase(context: IActionContext, node?: DatabaseItem): Promise<void> {
    // node ??= ... pick a node if not provided
    if (!node) {
        throw new Error('No database selected.');
    }

    const confirmed = await getConfirmationWithWordQuestion(
        `Drop "${node?.databaseInfo.name}"?`,
        `Drop database "${node?.databaseInfo.name}" and its contents?\nThis can't be undone.\n\n` +
            'Please type the name of the database to confirm:',
        node?.databaseInfo.name,
    );

    if (!confirmed) {
        return;
    }

    await node.delete(context);
}
