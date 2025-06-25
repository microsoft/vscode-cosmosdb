/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../extensionVariables';
import { type TreeElement } from '../../tree/TreeElement';
import { isTreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';

/**
 * Command to retry for a failed tree node.
 * This command clears the error state for the specified node and refreshes it,
 * allowing the user to retry operations that previously failed due to authentication
 * or connectivity issues.
 *
 * @param _context Action context for telemetry and error handling
 * @param element The tree element to retry the operation for, or a retry element clicked by the user
 */
export async function retryOperation(_context: IActionContext, element: TreeElement): Promise<void> {
    if (!element) {
        throw new Error(l10n.t('No node selected.'));
    }

    if (!element.id) {
        throw new Error(l10n.t('Cannot retry for node without ID.'));
    }

    if (!isTreeElementWithContextValue(element)) {
        throw new Error(l10n.t('Cannot retry for node without context value.'));
    }

    if (element.contextValue && /cosmosDB\.azure/i.test(element.contextValue)) {
        ext.cosmosDBBranchDataProvider.resetNodeErrorState(element.id);
        return ext.cosmosDBBranchDataProvider.refresh(element);
    }

    if (element.contextValue && /cosmosDB\.workspace/i.test(element.contextValue)) {
        ext.cosmosDBWorkspaceBranchDataProvider.resetNodeErrorState(element.id);
        return ext.cosmosDBWorkspaceBranchDataProvider.refresh(element);
    }

    // Fallback: try both providers if context is unclear
    // This covers cases where the error node might not have a specific context
    try {
        ext.cosmosDBBranchDataProvider.resetNodeErrorState(element.id);
        ext.cosmosDBWorkspaceBranchDataProvider.resetNodeErrorState(element.id);

        ext.cosmosDBBranchDataProvider.refresh(element);
        ext.cosmosDBWorkspaceBranchDataProvider.refresh(element);
    } catch (error) {
        throw new Error(
            l10n.t(
                'Unable to determine the correct provider for operation retry: {0}',
                error instanceof Error ? error.message : String(error),
            ),
        );
    }
}
