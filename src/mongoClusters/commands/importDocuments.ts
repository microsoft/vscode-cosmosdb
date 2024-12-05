/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { importDocuments } from '../../commands/importDocuments';
import { type CollectionItem } from '../tree/CollectionItem';

export async function mongoClustersImportDocuments(
    context: IActionContext,
    collectionNode?: CollectionItem,
    _collectionNodes?: CollectionItem[], // required by the TreeNodeCommandCallback, but not used
    ...args: unknown[]
): Promise<void> {
    const source = (args[0] as { source?: string })?.source || 'contextMenu';
    context.telemetry.properties.calledFrom = source;

    return importDocuments(context, undefined, collectionNode);
}
