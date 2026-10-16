/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { type TypedEventSink } from '@microsoft/vscode-ext-webview';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { AuthenticationMethod } from '../../../cosmosdb/AuthenticationMethod';
import { wellKnownEmulatorPassword } from '../../../cosmosdb/cosmosdb-shared-constants';
import { type CosmosDBCredential } from '../../../cosmosdb/CosmosDBCredential';
import { getCosmosClient } from '../../../cosmosdb/getCosmosClient';
import { getSignedInPrincipalIdForSubscription } from '../../../cosmosdb/utils/azureSessionHelper';
import { addRbacContributorPermission, isRbacException } from '../../../cosmosdb/utils/rbacUtils';
import { ext } from '../../../extensionVariables';
import { type MigrationProjectService, type ProjectJson } from '../../../services/MigrationProjectService';
import { type MigrationEvent } from '../../trpc/routers/migrationEventsRouter';
import { sendPhaseProgress } from './migrationHelpers';
import { setMigrationTelemetryContext } from './migrationTelemetry';

// ─── Types ──────────────────────────────────────────────────────────

/**
 * Thrown when the user-provided endpoint does not use the required HTTPS protocol.
 * Using a typed error lets callers detect the condition reliably, without matching
 * on localized error messages.
 */
export class HttpsPolicyRequiredError extends Error {
    constructor() {
        super(l10n.t('Endpoint must use HTTPS.'));
        this.name = 'HttpsPolicyRequiredError';
    }
}

export interface MigrationConnectionContext {
    project: ProjectJson;
    projectService: MigrationProjectService;
    channel: TypedEventSink<MigrationEvent>;
}

// ─── Connection Testing ─────────────────────────────────────────────

/**
 * Tests the connection to the target Cosmos DB environment (emulator or Azure).
 * If an RBAC permission error is detected for a non-emulator target, prompts
 * the user to assign the Data Contributor role and retries.
 */
export async function testConnection(ctx: MigrationConnectionContext, subscription?: AzureSubscription): Promise<void> {
    const { project, projectService, channel } = ctx;

    await callWithTelemetryAndErrorHandling('cosmosDB.migration.phase4.connectionTest', async (context) => {
        setMigrationTelemetryContext(context, project, 'provisioning');
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.forceIncludeInReportIssueCommand = true;
        if (!project?.phases.targetEnvironment) return;

        const target = project.phases.targetEnvironment;

        channel.emit({
            type: 'event',
            name: 'connectionTestStarted',
            params: [],
        });

        const reportSuccess = async (): Promise<void> => {
            target.verified = true;
            target.verifiedAt = new Date().toISOString();
            await projectService.save(project);
            channel.emit({
                type: 'event',
                name: 'connectionTestResult',
                params: [{ success: true }],
            });
        };

        try {
            await tryConnect(target);
            await reportSuccess();
        } catch (error) {
            // Check for RBAC permission errors on non-emulator targets
            if (
                target.type !== 'emulator' &&
                error instanceof Error &&
                isRbacException(error) &&
                subscription &&
                target.accountName &&
                target.resourceGroup
            ) {
                const rbacFixed = await handleRbacError(
                    channel,
                    target.accountName,
                    target.resourceGroup,
                    subscription,
                    context,
                );

                if (rbacFixed) {
                    // Retry the connection test after role assignment
                    try {
                        await tryConnect(target);
                        await reportSuccess();
                        return;
                    } catch {
                        // Retry failed — fall through to report the original RBAC error
                    }
                }
            }

            reportConnectionTestFailure(channel, target, error);
        }
    });
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Resolves the target connection and performs a minimal read (`databases.readAll()`)
 * to validate reachability and authentication. Any error propagates unchanged so
 * callers can classify it (RBAC, HTTPS policy, network, etc.).
 */
async function tryConnect(target: NonNullable<ProjectJson['phases']['targetEnvironment']>): Promise<void> {
    const { endpoint, credentials, isEmulator } = resolveTargetConnection(target);
    const client = getCosmosClient(endpoint, credentials, isEmulator);
    await client.databases.readAll().fetchAll();
}

/**
 * Resolves the endpoint and credentials for the target environment.
 */
function resolveTargetConnection(target: NonNullable<ProjectJson['phases']['targetEnvironment']>): {
    endpoint: string;
    credentials: CosmosDBCredential[];
    isEmulator: boolean;
} {
    const isEmulator = target.type === 'emulator';
    let endpoint: string;

    if (isEmulator) {
        const emulatorPort = vscode.workspace.getConfiguration('cosmosDB').get<number>('emulator.port') ?? 8081;
        endpoint = `https://localhost:${emulatorPort}`;
    } else {
        endpoint = target.endpoint ?? '';
        if (!endpoint) {
            throw new Error(l10n.t('No endpoint provided.'));
        }
        let parsed: URL;
        try {
            parsed = new URL(endpoint);
        } catch {
            throw new Error(
                l10n.t('Endpoint must be a valid URL (e.g. https://your-account.documents.azure.com:443/).'),
            );
        }
        if (parsed.protocol !== 'https:') {
            throw new HttpsPolicyRequiredError();
        }
    }

    const credentials = isEmulator
        ? [{ type: AuthenticationMethod.accountKey as const, key: wellKnownEmulatorPassword }]
        : [{ type: AuthenticationMethod.entraId as const, tenantId: target.tenantId }];

    return { endpoint, credentials, isEmulator };
}

/**
 * Handles an RBAC permission error during connection testing.
 * Prompts the user to assign the Data Contributor role and performs the assignment.
 * Returns true if the role was successfully assigned.
 */
async function handleRbacError(
    channel: TypedEventSink<MigrationEvent>,
    accountName: string,
    resourceGroup: string,
    subscription: AzureSubscription,
    context: IActionContext,
): Promise<boolean> {
    const principalId = await getSignedInPrincipalIdForSubscription(subscription);

    if (!principalId) {
        ext.outputChannel.warn('[Migration] Could not resolve signed-in principal ID for RBAC assignment.');
        return false;
    }

    // Prompt the user
    const message =
        l10n.t("You need the 'Cosmos DB Built-in Data Contributor' RBAC role to access data in this account.") +
        '\n\n' +
        l10n.t('Account Name: {name}', { name: accountName }) +
        '\n' +
        l10n.t('Subscription: {id}', { id: subscription.name });

    const setPermissionItem = l10n.t('Assign Role');
    const result = await vscode.window.showWarningMessage(message, { modal: true }, setPermissionItem);

    if (result !== setPermissionItem) {
        return false;
    }

    try {
        await sendPhaseProgress(
            channel,
            'Provisioning',
            'connectionTestProgress',
            l10n.t('Assigning RBAC data plane permissions…'),
        );

        await addRbacContributorPermission(accountName, principalId, resourceGroup, context, subscription);
        ext.outputChannel.appendLog(
            `[Migration] Successfully assigned Data Contributor role to principal ${principalId} on account ${accountName}.`,
        );
        return true;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        ext.outputChannel.error(`[Migration] RBAC role assignment failed: ${errorMessage}`);
        void vscode.window.showErrorMessage(
            l10n.t(
                'Failed to assign the RBAC role. You may not have sufficient permissions. Please ask the account owner to assign the "Cosmos DB Built-in Data Contributor" role to your identity.',
            ),
        );
        return false;
    }
}

/**
 * Reports a connection test failure to the user with appropriate error messaging.
 */
function reportConnectionTestFailure(
    channel: TypedEventSink<MigrationEvent>,
    target: NonNullable<ProjectJson['phases']['targetEnvironment']>,
    error: unknown,
): void {
    const parsedError = parseError(error);
    const rawMessage = parsedError.message || l10n.t('Connection failed. Is the target running?');
    ext.outputChannel.error(`[Migration] Test connection failed: ${rawMessage}`);
    console.error('[Migration] Test connection failed:', error);

    let errorMessage: string;
    let documentationUrl: string | undefined;

    if (target.type === 'emulator') {
        documentationUrl =
            'https://learn.microsoft.com/azure/cosmos-db/how-to-develop-emulator?tabs=docker-linux%2Ccsharp&pivots=api-nosql';
        errorMessage = l10n.t(
            'Could not connect to the local Cosmos DB Emulator. Please ensure the emulator is installed and running. You can start it using "docker-compose up -d" or by launching the emulator application.',
        );
    } else if (error instanceof Error && isRbacException(error)) {
        documentationUrl = 'https://aka.ms/cosmos-native-rbac';
        errorMessage = l10n.t(
            'You do not have the required RBAC permissions to access this account. Please ask the account owner to assign the "Cosmos DB Built-in Data Contributor" role to your identity.',
        );
    } else {
        errorMessage = rawMessage;
    }

    void vscode.window.showErrorMessage(l10n.t('Connection test failed: {0}', rawMessage));
    channel.emit({
        type: 'event',
        name: 'connectionTestResult',
        params: [{ success: false, error: errorMessage, documentationUrl }],
    });
}
