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
import * as fabric from '@microsoft/vscode-fabric-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';
import { type FabricArtifactType } from './constants';
import { getIsRunningOnAzure } from './cosmosdb/utils/managedIdentityUtils';
import { DatabasesFileSystem } from './DatabasesFileSystem';
import { ext } from './extensionVariables';
import { CosmosDBBranchDataProvider } from './tree/azure-resources-view/cosmosdb/CosmosDBBranchDataProvider';
import { FabricTreeNodeProvider } from './tree/fabric-resources-view/FabricTreeNodeProvider';
import {
    SharedWorkspaceResourceProvider,
    WorkspaceResourceType,
} from './tree/workspace-api/SharedWorkspaceResourceProvider';
import { CosmosDBWorkspaceBranchDataProvider } from './tree/workspace-view/cosmosdb/CosmosDBWorkspaceBranchDataProvider';
import { globalUriHandler } from './vscodeUriHandler';

export async function activateInternal(
    context: vscode.ExtensionContext,
): Promise<apiUtils.AzureExtensionApiProvider | undefined> {
    const startTime = performance.now();

    // Initialize Azure utils ext variables
    // Must be before calling registerUIExtensionVariables
    ext.context = context;
    ext.isBundle = !!process.env.IS_BUNDLE;
    ext.outputChannel = createAzExtLogOutputChannel('Azure Cosmos DB');
    context.subscriptions.push(ext.outputChannel);

    // Register Azure resources providers
    // Must be before calling callWithTelemetryAndErrorHandling
    registerUIExtensionVariables(ext);
    registerAzureUtilsExtensionVariables(ext);

    return callWithTelemetryAndErrorHandling('cosmosDB.activate', async (activateContext: IActionContext) => {
        activateContext.telemetry.properties.isActivationEvent = 'true';
        activateContext.telemetry.measurements.startTime = startTime;

        // eslint-disable-next-line no-restricted-syntax
        if (vscode.l10n.uri) {
            const l10nStartTime = performance.now();

            l10n.config({
                // eslint-disable-next-line no-restricted-syntax
                contents: vscode.l10n.bundle ?? {},
            });

            activateContext.telemetry.measurements.l10nLoadTime = performance.now() - l10nStartTime;
        }

        // Early initialization to determine whether Managed Identity is available for authentication
        // Requires ext.outputChannel to be set
        void getIsRunningOnAzure();

        ext.secretStorage = context.secrets;
        ext.state = new TreeElementStateManager();
        ext.cosmosDBBranchDataProvider = new CosmosDBBranchDataProvider();
        ext.cosmosDBWorkspaceBranchDataProvider = new CosmosDBWorkspaceBranchDataProvider();
        ext.fileSystem = new DatabasesFileSystem();

        context.subscriptions.push(
            vscode.workspace.registerFileSystemProvider(DatabasesFileSystem.scheme, ext.fileSystem),
        );

        context.subscriptions.push(vscode.window.registerUriHandler({ handleUri: globalUriHandler }));

        // Register common commands
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

        const fabricCore = vscode.extensions.getExtension<fabric.IFabricExtensionManager>('fabric.vscode-fabric');
        if (fabricCore) {
            const fabricStartTime = performance.now();

            await registerFabricProviders(context, fabricCore.exports);

            activateContext.telemetry.measurements.fabricLoadTime = performance.now() - fabricStartTime;
        }

        // The user can turn off Azure Resources extension. Or do not have it at all, only Fabric.
        let apiProvider: apiUtils.AzureExtensionApiProvider | undefined = undefined;
        const azureResources = vscode.extensions.getExtension('ms-azuretools.vscode-azureresourcegroups');
        if (azureResources) {
            const azureResourcesStartTime = performance.now();

            apiProvider = registerAzureResourcesProviders(context);

            activateContext.telemetry.measurements.azureResourcesApiLoadTime =
                performance.now() - azureResourcesStartTime;
        }

        vscode.commands.executeCommand('cosmosDB.ai.deployInstructionFiles');

        const endTime = performance.now();
        activateContext.telemetry.measurements.endTime = endTime;
        activateContext.telemetry.measurements.totalActivationTime = endTime - startTime;

        return apiProvider;
    });
}

function registerAzureResourcesProviders(_context: vscode.ExtensionContext): apiUtils.AzureExtensionApiProvider {
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

    return createApiProvider([clientApi]);
}

function registerFabricProviders(
    context: vscode.ExtensionContext,
    fabricApi: fabric.IFabricExtensionManager,
): Promise<void> {
    ext.fabricNativeTreeNodeProvider = new FabricTreeNodeProvider(context, 'CosmosDBDatabase');
    ext.fabricMirroredTreeNodeProvider = new FabricTreeNodeProvider(context, 'MirroredDatabase');

    // Register Fabric providers and commands
    const extension: fabric.IFabricExtension & { artifactTypes: FabricArtifactType[] } = {
        identity: context.extension.id,
        apiVersion: String(fabric.apiVersion),
        artifactTypes: ['CosmosDBDatabase', 'MirroredDatabase'],
        treeNodeProviders: [ext.fabricNativeTreeNodeProvider, ext.fabricMirroredTreeNodeProvider],
        localProjectTreeNodeProviders: [],
        artifactHandlers: [],
    };

    ext.fabricServices = fabricApi.addExtension(extension);

    return Promise.resolve();
}

// this method is called when your extension is deactivated
export function deactivateInternal(_context: vscode.ExtensionContext): void {
    // NOOP
}
