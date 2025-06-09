/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../extensionVariables';
import { type TreeElement } from '../../tree/TreeElement';

/**
 * Command to retry authentication for a failed tree node.
 * This command clears the error state for the specified node and refreshes it,
 * allowing the user to retry operations that previously failed due to authentication
 * or connectivity issues.
 *
 * @param _context Action context for telemetry and error handling
 * @param nodeOrRetryElement The tree element to retry authentication for, or a retry element clicked by the user
 */
export async function retryAuthentication(_context: IActionContext, nodeOrRetryElement: TreeElement): Promise<void> {
    if (!nodeOrRetryElement) {
        throw new Error(l10n.t('No node selected.'));
    }

    if (!nodeOrRetryElement.id) {
        throw new Error(l10n.t('Cannot retry authentication for node without ID.'));
    }

    // If this is a retry element (ID ends with /reconnect), find the parent element
    let parentId = nodeOrRetryElement.id;
    if (parentId.endsWith('/reconnect')) {
        parentId = parentId.substring(0, parentId.lastIndexOf('/reconnect'));
    }

    // Determine which branch data provider to use based on the node's context
    const contextValue = (await nodeOrRetryElement.getTreeItem()).contextValue;
    
    if (contextValue && /cosmosDB\.azure/i.test(contextValue)) {
        // Clear error state and refresh for Azure CosmosDB nodes
        ext.cosmosDBBranchDataProvider.resetNodeErrorState(parentId);
        // Create a mock element with the parent ID for refresh
        const parentElement = { id: parentId } as TreeElement;
        return ext.cosmosDBBranchDataProvider.refresh(parentElement);
    }

    if (contextValue && /cosmosDB\.workspace/i.test(contextValue)) {
        // Clear error state and refresh for workspace CosmosDB nodes  
        ext.cosmosDBWorkspaceBranchDataProvider.resetNodeErrorState(parentId);
        // Create a mock element with the parent ID for refresh
        const parentElement = { id: parentId } as TreeElement;
        return ext.cosmosDBWorkspaceBranchDataProvider.refresh(parentElement);
    }

    // Fallback: try both providers if context is unclear
    // This covers cases where the error node might not have a specific context
    try {
        ext.cosmosDBBranchDataProvider.resetNodeErrorState(parentId);
        ext.cosmosDBWorkspaceBranchDataProvider.resetNodeErrorState(parentId);
        
        // Create a mock element with the parent ID for refresh
        const parentElement = { id: parentId } as TreeElement;
        
        // Try to refresh with the first provider that doesn't throw
        try {
            await ext.cosmosDBBranchDataProvider.refresh(parentElement);
        } catch {
            await ext.cosmosDBWorkspaceBranchDataProvider.refresh(parentElement);
        }
    } catch (error) {
        throw new Error(l10n.t('Unable to determine the correct provider for authentication retry: {0}', error instanceof Error ? error.message : String(error)));
    }
}