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
): Promise<void> {
    return importDocuments(context, undefined, collectionNode);
}
