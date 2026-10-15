/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { WorkspaceResourceType } from '../tree/workspace-api/SharedWorkspaceResourceProvider';

export async function revealAttachedAccounts(parentId: string): Promise<void> {
    const rootId: string = WorkspaceResourceType.AttachedAccounts;
    await vscode.commands.executeCommand('azureWorkspace.focus');

    // Reveal the root first so the resource API can resolve nested groups such as Local Emulators.
    await ext.rgApiV2.resources.revealWorkspaceResource(rootId, {
        select: true,
        focus: true,
        expand: true,
    });
    if (parentId !== rootId) {
        await ext.rgApiV2.resources.revealWorkspaceResource(parentId, {
            select: true,
            focus: true,
            expand: true,
        });
    }
}
