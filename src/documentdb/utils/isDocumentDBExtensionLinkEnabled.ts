/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * This function determines whether the integration with the DocumentDB Extension should be enabled.
 *
 * It checks the package.json configuration of the vscode-cosmosdb extension to see if the
 * DocumentDB Extension integration feature flag is enabled.
 *
 * This approach enables a staged rollout of DocumentDB feature in the Azure Databases extension.
 * Once the feature is fully implemented, the flag can be removed from the package.json
 *
 * @returns boolean indicating if the DocumentDB Extension integration is enabled
 */
export function isDocumentDBExtensionLinkEnabled() {
    const vsCodeCosmosDBConfiguration = vscode.extensions.getExtension('ms-azuretools.vscode-cosmosdb')
        ?.packageJSON as DocumentDBExtensionIntegration;
    return vsCodeCosmosDBConfiguration && vsCodeCosmosDBConfiguration.enableDocumentDBExtensionIntegration;
}

/**
 * Interface representing the relevant part of the packageJSON structure.
 * Used to type-safely access the DocumentDB extension integration configuration.
 */
interface DocumentDBExtensionIntegration {
    readonly enableDocumentDBExtensionIntegration?: boolean;
}
