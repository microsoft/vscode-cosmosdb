import * as vscode from 'vscode';

/**
 * This is a temporary function usend to optionaly enable support for MongoClusters in the Azure Resources extension.
 *
 * This solution is necessary for a staged release of the MongoClusters feature from the vscode-cosmosdb extension.
 * It will be removed once the MongoClusters feature is fully released.
 *
 * @returns
 */
export function isMongoClustersSupportenabled() {
    const vsCodeCosmosDBConfiguration = vscode.extensions.getExtension('ms-azuretools.vscode-cosmosdb')
        ?.packageJSON as ExtensionPackageMongoClustersEnabled;
    return vsCodeCosmosDBConfiguration && vsCodeCosmosDBConfiguration.enableMongoClusters;
}

/**
 * This is a temporary interface used to enable support for MongoClusters in the Azure Resources extension.
 * It will be removed once the MongoClusters feature is fully released.
 */
interface ExtensionPackageMongoClustersEnabled {
    readonly enableMongoClusters?: boolean;
}
