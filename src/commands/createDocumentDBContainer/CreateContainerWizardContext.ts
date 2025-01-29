/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AccountInfo } from '../../tree/docdb/AccountInfo';

export interface CreateContainerWizardContext extends IActionContext {
    containerName?: string;
    partitionKey?: PartitionKeyDefinition;
    throughput?: number;

    accountInfo: AccountInfo;
    databaseId: string;
    nodeId: string;
}
