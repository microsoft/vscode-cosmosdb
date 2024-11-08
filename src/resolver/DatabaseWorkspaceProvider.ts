/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    GenericTreeItem,
    type AzExtParentTreeItem,
    type AzExtTreeItem,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { type WorkspaceResourceProvider } from '@microsoft/vscode-azext-utils/hostapi';
import { Disposable } from 'vscode';
import { ext } from '../extensionVariables';
import { AttachedAccountsTreeItem } from '../tree/AttachedAccountsTreeItem';

export class DatabaseWorkspaceProvider implements WorkspaceResourceProvider {
    public disposables: Disposable[] = [];

    constructor(parent: AzExtParentTreeItem) {
        ext.attachedAccountsNode = new AttachedAccountsTreeItem(parent);
    }

    public async provideResources(): Promise<AzExtTreeItem[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling(
            'AzureAccountTreeItemWithProjects.provideResources',
            async (_context: IActionContext) => {
                return [
                    ext.attachedAccountsNode,
                    new GenericTreeItem(undefined, { label: '🚀 Hello from your Workspace!', contextValue: 'hello' }),
                ];
            },
        );
    }
    private _projectDisposables: Disposable[] = [];

    public dispose(): void {
        Disposable.from(...this._projectDisposables).dispose();
    }
}
