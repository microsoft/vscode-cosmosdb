/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type CosmosDBControlPlane } from '../../cosmosdb/controlPlane';
import {
    DeploymentRequestSchema,
    type DeploymentOptions,
    type DeploymentRequest,
    type DeploymentTemplateInput,
    type ModelDeploymentResult,
} from '../../dataModeling/deploymentModel';
import { ext } from '../../extensionVariables';
import { type CosmosModel } from '../../panels/migration/cosmosModel';
import { buildBicepTemplate } from '../../panels/migration/helpers/bicepGenerator';
import { provisionCosmosModel } from '../../panels/migration/helpers/provisionCosmosModel';
import { type DataModelerAccount } from '../../services/DataModelerProjectService';
import { type ContainerResource } from '../../tree/cosmosdb/models/CosmosDBTypes';
import { createDeploymentModel, missingContainers } from './deploymentTemplate';

const deployingAccounts = new Set<string>();
const unavailableReason = () =>
    l10n.t('Reopen the Data Modeler from the account in Explorer or Account Overview to deploy this model.');

function requireControlPlane(account: DataModelerAccount): CosmosDBControlPlane {
    if (!account.getControlPlane) throw new Error(unavailableReason());
    return account.getControlPlane();
}

export async function getDeploymentOptions(account: DataModelerAccount): Promise<DeploymentOptions> {
    const metadata = account.getDeploymentTarget?.();
    const target = {
        accountName: metadata?.accountName ?? account.name ?? account.endpoint,
        ...(metadata
            ? {
                  subscriptionName: metadata.subscription.name || metadata.subscription.subscriptionId,
                  resourceGroup: metadata.resourceGroup,
              }
            : {}),
    };
    if (!account.getControlPlane) {
        return { ...target, databases: [], unavailableReason: unavailableReason() };
    }
    const databases = await account.getControlPlane().listDatabases();
    return { ...target, databases: databases.map((database) => database.id) };
}

async function checkDatabase(
    plane: CosmosDBControlPlane,
    input: DeploymentTemplateInput,
    enforceNewName: boolean,
): Promise<ContainerResource[]> {
    const databases = await plane.listDatabases();
    const exists = databases.some((database) => database.id === input.databaseName);
    if (input.databaseMode === 'new') {
        if (exists && enforceNewName) {
            throw new Error(
                l10n.t('The database "{name}" already exists in the account.', { name: input.databaseName }),
            );
        }
        return [];
    }
    if (!exists) throw new Error(l10n.t('The selected database no longer exists. Select a database again.'));
    return plane.listContainers(input.databaseName);
}

function exportTemplate(account: DataModelerAccount, input: DeploymentTemplateInput, model: CosmosModel): string {
    return buildBicepTemplate(model, {
        existingAccount: true,
        existingDatabase: input.databaseMode === 'existing',
        accountName: account.getDeploymentTarget?.()?.accountName,
    });
}

export async function generateDeploymentTemplate(
    account: DataModelerAccount,
    input: DeploymentTemplateInput,
): Promise<string> {
    const model = createDeploymentModel(input);
    const existing = await checkDatabase(requireControlPlane(account), input, false);
    missingContainers(model, existing);
    return exportTemplate(account, input, model);
}

/** Uses migration's resource pipeline. Bicep is an optional export, not the built-in deployment input. */
export async function deployDataModel(
    account: DataModelerAccount,
    request: DeploymentRequest,
    context: IActionContext,
): Promise<ModelDeploymentResult> {
    context.telemetry.suppressAll = true;
    context.errorHandling.suppressDisplay = true;
    const accountKey = new URL(account.endpoint).href.replace(/\/+$/, '');
    if (deployingAccounts.has(accountKey))
        throw new Error(l10n.t('A data model deployment is already in progress for this account.'));
    deployingAccounts.add(accountKey);
    let writesStarted = false;
    try {
        const input = DeploymentRequestSchema.parse(request);
        const model = createDeploymentModel(input);
        context.valuesToMask.push(
            account.endpoint,
            input.databaseName,
            ...input.containers.flatMap((container) => [container.entity, container.partitionKey]),
        );
        const plane = requireControlPlane(account);
        missingContainers(model, await checkDatabase(plane, input, true));
        const deploy = l10n.t('Deploy');
        const confirmed = await vscode.window.showWarningMessage(
            l10n.t('Deploy data model to "{database}" in "{account}"?', {
                database: input.databaseName,
                account: account.name ?? account.endpoint,
            }),
            {
                modal: true,
                detail: l10n.t(
                    'Deploy {count} selected container(s): {containers}. Built-in deployment uses the migration provisioning pipeline, without Bicep CLI. Matching existing containers are left unchanged. Azure usage may incur charges. No documents are uploaded.',
                    {
                        count: input.containers.length,
                        containers: input.containers.map((container) => container.entity).join(', '),
                    },
                ),
            },
            deploy,
        );
        if (confirmed !== deploy) return { status: 'cancelled' };
        const created = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: l10n.t('Deploying data model'),
                cancellable: false,
            },
            async (progress) => {
                const pending = missingContainers(model, await checkDatabase(plane, input, true));
                return provisionCosmosModel(
                    pending,
                    input.databaseName,
                    {
                        createDatabase: async (name) => {
                            writesStarted = true;
                            return plane.createDatabase(name);
                        },
                        createContainer: async (name, definition, maxThroughput) => {
                            writesStarted = true;
                            return plane.createContainer(name, definition, undefined, maxThroughput);
                        },
                    },
                    {
                        createDatabase: input.databaseMode === 'new',
                        onProgress: (resource, name) =>
                            progress.report({
                                message:
                                    resource === 'database'
                                        ? l10n.t('Creating database "{name}"…', { name })
                                        : l10n.t('Creating container "{name}"…', { name }),
                            }),
                    },
                );
            },
        );
        if (!created) throw new vscode.CancellationError();
        const result: ModelDeploymentResult = {
            status: 'deployed',
            databaseName: input.databaseName,
            createdCount: created.length,
            existingCount: model.containers.length - created.length,
        };
        void vscode.window.showInformationMessage(
            l10n.t('Data model deployed to "{database}": {created} container(s) created, {existing} left unchanged.', {
                database: result.databaseName,
                created: result.createdCount,
                existing: result.existingCount,
            }),
        );
        return result;
    } catch (error) {
        const message = l10n.t('Data model deployment failed: {error}', { error: parseError(error).message });
        void vscode.window.showErrorMessage(
            writesStarted
                ? message +
                      '\n' +
                      l10n.t(
                          'Some resources may already have been created. Retry using the existing database. Matching containers will be left unchanged.',
                      )
                : message,
        );
        throw error;
    } finally {
        deployingAccounts.delete(accountKey);
        if (writesStarted) {
            ext.cosmosDBBranchDataProvider.refresh();
            ext.cosmosDBWorkspaceBranchDataProvider.refresh();
        }
    }
}
