/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { registerAzureUtilsExtensionVariables } from '@microsoft/vscode-azext-azureutils';
import {
    callWithTelemetryAndErrorHandling,
    createApiProvider,
    createAzExtLogOutputChannel,
    registerErrorHandler,
    registerEvent,
    registerReportIssueCommand,
    registerUIExtensionVariables,
    TreeElementStateManager,
    type apiUtils,
    type AzureExtensionApi,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { type AzureResourcesExtensionApiWithActivity } from '@microsoft/vscode-azext-utils/activity';
import {
    AzExtResourceType,
    prepareAzureResourcesApiRequest,
    type AzureResourcesApiRequestContext,
    type AzureResourcesExtensionApi,
} from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';
import { getIsRunningOnAzure } from './cosmosdb/utils/managedIdentityUtils';
import { DatabasesFileSystem } from './DatabasesFileSystem';
import { ext } from './extensionVariables';
import { CosmosDBBranchDataProvider } from './tree/azure-resources-view/cosmosdb/CosmosDBBranchDataProvider';
import {
    SharedWorkspaceResourceProvider,
    WorkspaceResourceType,
} from './tree/workspace-api/SharedWorkspaceResourceProvider';
import { CosmosDBWorkspaceBranchDataProvider } from './tree/workspace-view/cosmosdb/CosmosDBWorkspaceBranchDataProvider';
import { globalUriHandler } from './vscodeUriHandler';

export async function activateInternal(
    context: vscode.ExtensionContext,
    perfStats: { loadStartTime: number; loadEndTime: number },
): Promise<apiUtils.AzureExtensionApiProvider> {
    ext.context = context;
    ext.isBundle = !!process.env.IS_BUNDLE;

    ext.outputChannel = createAzExtLogOutputChannel('Azure Cosmos DB');
    context.subscriptions.push(ext.outputChannel);

    registerUIExtensionVariables(ext);
    registerAzureUtilsExtensionVariables(ext);

    // eslint-disable-next-line no-restricted-syntax
    if (vscode.l10n.uri) {
        l10n.config({
            // eslint-disable-next-line no-restricted-syntax
            contents: vscode.l10n.bundle ?? {},
        });
    }

    await callWithTelemetryAndErrorHandling('cosmosDB.activate', (activateContext: IActionContext) => {
        activateContext.telemetry.properties.isActivationEvent = 'true';
        activateContext.telemetry.measurements.mainFileLoad = (perfStats.loadEndTime - perfStats.loadStartTime) / 1000;

        ext.secretStorage = context.secrets;

        // Early initialization to determine whether Managed Identity is available for authentication
        void getIsRunningOnAzure();

        ext.state = new TreeElementStateManager();
        ext.cosmosDBBranchDataProvider = new CosmosDBBranchDataProvider();
        ext.cosmosDBWorkspaceBranchDataProvider = new CosmosDBWorkspaceBranchDataProvider();

        ext.fileSystem = new DatabasesFileSystem();

        context.subscriptions.push(
            vscode.workspace.registerFileSystemProvider(DatabasesFileSystem.scheme, ext.fileSystem),
        );

        context.subscriptions.push(vscode.window.registerUriHandler({ handleUri: globalUriHandler }));

        registerCommands();

        registerEvent(
            'cosmosDB.onDidChangeConfiguration',
            vscode.workspace.onDidChangeConfiguration,
            async (actionContext: IActionContext, event: vscode.ConfigurationChangeEvent) => {
                actionContext.telemetry.properties.isActivationEvent = 'true';
                actionContext.errorHandling.suppressDisplay = true;
                if (event.affectsConfiguration(ext.settingsKeys.documentLabelFields)) {
                    await vscode.commands.executeCommand('azureDatabases.refresh');
                }
            },
        );

        // Suppress "Report an Issue" button for all errors in favor of the command
        registerErrorHandler((c) => (c.errorHandling.suppressReportIssue = true));
        registerReportIssueCommand('azureDatabases.reportIssue');
    });

    const exportedApi: AzureExtensionApi = { apiVersion: '1.2.0' };
    const v2: string = '^2.0.0';
    const requestContext: AzureResourcesApiRequestContext = {
        azureResourcesApiVersions: [v2],
        clientExtensionId: 'ms-azuretools.vscode-cosmosdb',

        // Successful retrieval of Azure Resources APIs will be returned here
        onDidReceiveAzureResourcesApis: (azureResourcesApis: (AzureResourcesExtensionApi | undefined)[]) => {
            const [rgApiV2] = azureResourcesApis;
            if (!rgApiV2) {
                throw new Error(l10n.t('Failed to find a matching Azure Resources API for version "{0}".', v2));
            }

            ext.rgApiV2 = rgApiV2 as AzureResourcesExtensionApiWithActivity;

            ext.rgApiV2.resources.registerAzureResourceBranchDataProvider(
                AzExtResourceType.AzureCosmosDb,
                ext.cosmosDBBranchDataProvider,
            );
            // Still shows PostgreSQL servers in the tree for now
            ext.rgApiV2.resources.registerAzureResourceBranchDataProvider(
                AzExtResourceType.PostgresqlServersStandard,
                ext.cosmosDBBranchDataProvider,
            );
            ext.rgApiV2.resources.registerAzureResourceBranchDataProvider(
                AzExtResourceType.PostgresqlServersFlexible,
                ext.cosmosDBBranchDataProvider,
            );
            ext.rgApiV2.resources.registerWorkspaceResourceProvider(new SharedWorkspaceResourceProvider());
            ext.rgApiV2.resources.registerWorkspaceResourceBranchDataProvider(
                WorkspaceResourceType.AttachedAccounts,
                ext.cosmosDBWorkspaceBranchDataProvider,
            );
        },
    };
    const { clientApi, requestResourcesApis } = prepareAzureResourcesApiRequest(requestContext, exportedApi);

    requestResourcesApis();

    console.log(`Registering APIs: ${exportedApi.apiVersion}, Azure Resources API ${clientApi.apiVersion}`);

    vscode.commands.executeCommand('cosmosDB.ai.deployInstructionFiles');

    return createApiProvider([clientApi]);
}

// this method is called when your extension is deactivated
export function deactivateInternal(_context: vscode.ExtensionContext): void {
    // NOOP
}
