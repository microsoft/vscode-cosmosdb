/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type WorkspaceResource, type WorkspaceResourceBranchDataProvider } from '@microsoft/vscode-azureresources-api';
import { ext } from '../../../extensionVariables';
import { BaseCachedBranchDataProvider } from '../../BaseCachedBranchDataProvider';
import { type TreeElement } from '../../TreeElement';
import { MigrationWorkspaceItem } from './MigrationWorkspaceItem';

export class MigrationWorkspaceBranchDataProvider
    extends BaseCachedBranchDataProvider<WorkspaceResource>
    implements WorkspaceResourceBranchDataProvider<TreeElement>
{
    protected get contextValue(): string {
        return 'cosmosDB.workspace.migrations';
    }

    protected onResourceItemRetrieved(
        cachedItem: MigrationWorkspaceItem,
        _resource?: WorkspaceResource,
        _context?: IActionContext,
        _fromCache?: boolean,
    ): void {
        ext.migrationWorkspaceBranchDataResource = cachedItem;
    }

    protected createResourceItem(_context: IActionContext, _resource: WorkspaceResource): TreeElement | undefined {
        return new MigrationWorkspaceItem();
    }
}
