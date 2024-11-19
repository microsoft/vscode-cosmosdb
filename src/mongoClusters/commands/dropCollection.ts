/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { localize } from '../../utils/localize';
import { type CollectionItem } from '../tree/CollectionItem';

export async function dropCollection(context: IActionContext, node?: CollectionItem): Promise<void> {
    // node ??= ... pick a node if not provided
    if (!node) {
        throw new Error('No collection selected.');
    }

    const confirmed = await getConfirmationAsInSettings(
        `Drop "${node?.collectionInfo.name}"?`,
        `Drop collection "${node?.collectionInfo.name}" and its contents?\nThis can't be undone.`,
        node?.collectionInfo.name,
    );

    if (!confirmed) {
        return;
    }

    const success = await node.delete(context);

    if (success) {
        showConfirmationAsInSettings(
            localize('showConfirmation.droppedCollection', 'The "{0}" collection has been dropped.', node.collectionInfo.name),
        );
    }
}
