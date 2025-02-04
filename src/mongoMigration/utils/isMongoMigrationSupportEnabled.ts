/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function isMongoMigrationSupportEnabled() {
    const vsCodeCosmosDBConfiguration = vscode.extensions.getExtension('ms-azuretools.vscode-cosmosdb')
        ?.packageJSON as ExtensionPackageMongoMigrationEnabled;
    return vsCodeCosmosDBConfiguration && vsCodeCosmosDBConfiguration.enableMongoMigration;
}

interface ExtensionPackageMongoMigrationEnabled {
    readonly enableMongoMigration?: boolean;
}
