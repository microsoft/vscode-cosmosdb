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
import { AzExtResourceType, getAzureResourcesExtensionApi } from '@microsoft/vscode-azureresources-api';
import * as fabric from '@microsoft/vscode-fabric-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';
import { FabricArtifactType } from './constants';
import { getIsRunningOnAzure } from './cosmosdb/utils/managedIdentityUtils';
import { DatabasesFileSystem } from './DatabasesFileSystem';
import { ext } from './extensionVariables';
import { CosmosDBBranchDataProvider } from './tree/azure-resources-view/cosmosdb/CosmosDBBranchDataProvider';
import { FabricNativeTreeNodeProvider } from './tree/fabric/FabricNativeTreeNodeProvider';
import {
    SharedWorkspaceResourceProvider,
    WorkspaceResourceType,
} from './tree/workspace-api/SharedWorkspaceResourceProvider';
import { CosmosDBWorkspaceBranchDataProvider } from './tree/workspace-view/cosmosdb/CosmosDBWorkspaceBranchDataProvider';
import { globalUriHandler } from './vscodeUriHandler';

export async function activateInternal(context: vscode.ExtensionContext): Promise<apiUtils.AzureExtensionApiProvider> {
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

    await callWithTelemetryAndErrorHandling('cosmosDB.activate', async (activateContext: IActionContext) => {
        activateContext.telemetry.properties.isActivationEvent = 'true';
        activateContext.telemetry.measurements.startTime = startTime;

        ext.context = context;
        ext.isBundle = !!process.env.IS_BUNDLE;

        // eslint-disable-next-line no-restricted-syntax
        if (vscode.l10n.uri) {
            const l10nStartTime = performance.now();

            l10n.config({
                // eslint-disable-next-line no-restricted-syntax
                contents: vscode.l10n.bundle ?? {},
            });

            activateContext.telemetry.measurements.l10nLoadTime = performance.now() - l10nStartTime;
        }

        const all = vscode.extensions.all;
        const active = vscode.extensions.all.filter((ext) => ext.isActive);

        console.log(`There are ${all.length} extensions installed, of which ${active.length} are active`);

        const fabricCore = vscode.extensions.getExtension<fabric.IFabricExtensionManager>('fabric.vscode-fabric');
        if (fabricCore) {
            const fabricStartTime = performance.now();

            if (!fabricCore.isActive) {
                try {
                    await fabricCore.activate();
                } catch (error) {
                    // Won't fail activation if fabric fails to activate
                    vscode.window.showWarningMessage(
                        l10n.t(
                            'Azure Cosmos DB extension could not activate Fabric API extension. Some Fabric-related features may not work as expected. Error: {0}',
                            String(error),
                        ),
                    );
                }
            }

            await registerFabricProviders(context, fabricCore.exports);

            activateContext.telemetry.measurements.fabricLoadTime = performance.now() - fabricStartTime;
        }

        // The user can turn off Azure Resources extension. Or do not have it at all, only Fabric.
        const azureResources = vscode.extensions.getExtension('ms-azuretools.vscode-azureresourcegroups');
        if (azureResources) {
            const azureResourcesStartTime = performance.now();

            if (!azureResources.isActive) {
                try {
                    await azureResources.activate();
                } catch (error) {
                    // Won't fail activation if Azure Resources fails to activate
                    vscode.window.showWarningMessage(
                        l10n.t(
                            'Azure Cosmos DB extension could not activate Azure Resources extension. Some Azure Resources-related features may not work as expected. Error: {0}',
                            String(error),
                        ),
                    );
                }
            }

            await registerAzureResourcesProviders(context);

            activateContext.telemetry.measurements.azureResourcesApiLoadTime =
                performance.now() - azureResourcesStartTime;
        }

        vscode.commands.executeCommand('cosmosDB.ai.deployInstructionFiles');

        const endTime = performance.now();
        activateContext.telemetry.measurements.endTime = endTime;
        activateContext.telemetry.measurements.totalActivationTime = endTime - startTime;
    });

    const exportedApis = [
        <AzureExtensionApi>{
            apiVersion: '1.2.0',
        },
    ];

    console.log(
        'Registering APIs:',
        exportedApis.map((a) => a.apiVersion),
    );

    return createApiProvider(exportedApis);
}

async function registerAzureResourcesProviders(context: vscode.ExtensionContext): Promise<void> {
    // Early initialization to determine whether Managed Identity is available for authentication
    // Requires ext.outputChannel to be set
    void getIsRunningOnAzure();

    ext.secretStorage = context.secrets;

    ext.state = new TreeElementStateManager();
    ext.cosmosDBBranchDataProvider = new CosmosDBBranchDataProvider();
    ext.cosmosDBWorkspaceBranchDataProvider = new CosmosDBWorkspaceBranchDataProvider();

    ext.rgApiV2 = (await getAzureResourcesExtensionApi(context, '2.0.0')) as AzureResourcesExtensionApiWithActivity;
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

    ext.fileSystem = new DatabasesFileSystem();

    context.subscriptions.push(vscode.workspace.registerFileSystemProvider(DatabasesFileSystem.scheme, ext.fileSystem));

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
}

function registerFabricProviders(
    context: vscode.ExtensionContext,
    fabricApi: fabric.IFabricExtensionManager,
): Promise<void> {
    // Register Fabric providers and commands
    const extension: fabric.IFabricExtension = {
        identity: context.extension.id,
        apiVersion: fabric.apiVersion,
        artifactTypes: [FabricArtifactType.NATIVE, FabricArtifactType.MIRRORED],
        treeNodeProviders: [new FabricNativeTreeNodeProvider(context)],
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
