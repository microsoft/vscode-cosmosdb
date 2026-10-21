/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureResourceMetadata } from '../../cosmosdb/AzureResourceMetadata';

export type DeleteAccountTarget = Pick<
    AzureResourceMetadata,
    'accountId' | 'accountName' | 'resourceGroup' | 'subscription'
>;

export interface DeleteWizardContext extends IActionContext {
    account: DeleteAccountTarget;
}
