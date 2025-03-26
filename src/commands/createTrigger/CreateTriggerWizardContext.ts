/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Resource, type TriggerDefinition, type TriggerOperation, type TriggerType } from '@azure/cosmos';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AccountInfo } from '../../tree/cosmosdb/AccountInfo';

export interface CreateTriggerWizardContext extends IActionContext {
    accountInfo: AccountInfo;
    databaseId: string;
    containerId: string;
    nodeId: string;

    triggerName?: string;
    triggerType?: TriggerType;
    triggerOperation?: TriggerOperation;
    triggerBody?: string;

    response?: TriggerDefinition & Resource;
}
