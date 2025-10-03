/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { KeyValueStore } from '../../KeyValueStore';
import { ext } from '../../extensionVariables';
import { type CosmosDBContainerResourceItem } from '../../tree/cosmosdb/CosmosDBContainerResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { noSqlQueryConnectionKey } from '../NoSqlCodeLensProvider';
import { createNoSqlQueryConnection } from '../utils/NoSqlQueryConnection';

export function setConnectedNoSqlContainer(node: CosmosDBContainerResourceItem): void {
    const noSqlQueryConnection = createNoSqlQueryConnection(node);
    KeyValueStore.instance.set(noSqlQueryConnectionKey, noSqlQueryConnection);
    ext.noSqlCodeLensProvider.updateCodeLens();
}

export async function connectNoSqlContainer(context: IActionContext): Promise<void> {
    const node = await pickAppResource<CosmosDBContainerResourceItem>(context, {
        type: [AzExtResourceType.AzureCosmosDb],
        expectedChildContextValue: ['treeItem.container'],
    });
    setConnectedNoSqlContainer(node);
}

export async function disconnectNoSqlContainer(): Promise<void> {
    KeyValueStore.instance.set(noSqlQueryConnectionKey, null);
    ext.noSqlCodeLensProvider.updateCodeLens();
}
