/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    type AzExtParentTreeItem,
    type AzExtTreeItem,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { type WorkspaceResourceProvider } from '@microsoft/vscode-azext-utils/hostapi';
import { ext } from '../../../extensionVariables';
import { AttachedAccountsTreeItem } from '../AttachedAccountsTreeItem';

export class DatabaseWorkspaceProvider implements WorkspaceResourceProvider {
    constructor(parent: AzExtParentTreeItem) {
        ext.attachedAccountsNode = new AttachedAccountsTreeItem(parent);
    }

    public async provideResources(): Promise<AzExtTreeItem[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling(
            'AzureAccountTreeItemWithProjects.provideResources',
            (_context: IActionContext) => [ext.attachedAccountsNode],
        );
    }
}
