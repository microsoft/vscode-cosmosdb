/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type ContainerPartitionKey as ArmContainerPartitionKey,
    type IndexingPolicy as ArmIndexingPolicy,
    type CosmosDBManagementClient,
} from '@azure/arm-cosmosdb';
import {
    PartitionKeyDefinitionVersion,
    PartitionKeyKind,
    type CosmosClient,
    type IndexingPolicy as CosmosIndexingPolicy,
    type PartitionKey,
} from '@azure/cosmos';
import { VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling, parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { type TypedEventSink } from '@microsoft/vscode-ext-webview';
import * as l10n from '@vscode/l10n';
import * as path from 'path';
import * as vscode from 'vscode';
import { AuthenticationMethod } from '../../../cosmosdb/AuthenticationMethod';
import { wellKnownEmulatorPassword } from '../../../cosmosdb/cosmosdb-shared-constants';
import { type CosmosDBCredential } from '../../../cosmosdb/CosmosDBCredential';
import { getCosmosClient } from '../../../cosmosdb/getCosmosClient';
import { getSignedInPrincipalIdForSubscription } from '../../../cosmosdb/utils/azureSessionHelper';
import {
    addCosmosDBOperatorRoleAssignment,
    addRbacContributorPermission,
    hasCosmosDBOperatorRoleAssignment,
    hasDataContributorRoleAssignment,
    isRbacException,
} from '../../../cosmosdb/utils/rbacUtils';
import { ext } from '../../../extensionVariables';
import { MigrationProjectService, type ProjectJson } from '../../../services/MigrationProjectService';
import { createCosmosDBManagementClient } from '../../../utils/azureClients';
import { validateCosmosDBAccountName } from '../../../utils/cosmosDBAccountName';
import { type MigrationEvent } from '../../trpc/routers/migrationEventsRouter';
import { getCosmosDbBestPractices } from '../bestPractices';
import { type CosmosModel, type IndexingPolicy } from '../cosmosModel';
import {
    createMkDebug,
    getSelectedModel,
    isDebugPromptsEnabled,
    runAgenticLoopWithJsonResult,
    type DebugPromptConfig,
} from '../helpers/aiHelpers';
import {
    buildBicepParams,
    buildBicepTemplate,
    mergeBicepParams,
    type BicepParamValues,
} from '../helpers/bicepGenerator';
import { saveAnalysisFile, sendPhaseEvent, sendPhaseProgress } from '../helpers/migrationHelpers';
import {
    buildPortableProvisioningArtifacts,
    getPortableProvisioningCapacity,
    hashPortableMigrationModel,
    normalizeFullTextPolicy,
    normalizeUniqueKeyPolicy,
    validatePortableMigrationModel,
    validatePortableProvisioningVerification,
    validatePortableSampleData,
    type ProvisioningVerificationReport,
} from '../helpers/migrationProvisioningContracts';
import {
    enrichErrorContext,
    extractAccountNameFromEndpoint,
    incrementRunCount,
    setMigrationTelemetryContext,
} from '../helpers/migrationTelemetry';
import { assertProvisioningAuthorized, type ProvisioningAuthorization } from '../helpers/provisioningAuthorization';
import { type SampleDataResult } from '../helpers/seedScriptHelpers';
import { Phase4SampleDataPrompt } from '../prompts';
import { createToolExecutor, getBestPracticeTools } from '../tools/migrationTools';

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

export interface Phase4BaseContext {
    project: ProjectJson;
    projectService: MigrationProjectService;
    channel: TypedEventSink<MigrationEvent>;
}

export interface Phase4Context extends Phase4BaseContext {
    client: CosmosClient;
    endpoint: string;
    cancellationToken: vscode.CancellationToken;
    /**
     * ARM (control-plane) coordinates for the target account. Required for
     * Azure-hosted accounts: Cosmos DB's native data-plane RBAC has no data
     * action for database/container lifecycle, so DDL (create/delete database,
     * create container) must go through the Azure Resource Manager API. When
     * omitted (emulator case), DDL falls back to the Cosmos DB SDK.
     */
    armTarget?: {
        subscription: AzureSubscription;
        resourceGroup: string;
        accountName: string;
    };
}

export interface ProvisioningResult {
    databaseName: string;
    containersCreated: string[];
    seedScriptPath: string;
    /**
     * Non-fatal issues surfaced during provisioning (e.g. a subset of sample
     * items failed to insert). Empty when everything succeeded.
     */
    warnings: string[];
}

function formatPortableErrors(errors: { path: string; message: string }[]): string {
    return errors.map((error) => `${error.path}: ${error.message}`).join('; ');
}

function provisioningFailureCode(error: unknown): string {
    if (typeof error === 'object' && error !== null) {
        const candidate = error as { code?: unknown; statusCode?: unknown };
        if (typeof candidate.code === 'string' || typeof candidate.code === 'number') return String(candidate.code);
        if (typeof candidate.statusCode === 'string' || typeof candidate.statusCode === 'number') {
            return String(candidate.statusCode);
        }
    }
    return 'unknown';
}

function observedIndexingPolicy(expected: IndexingPolicy, actual: CosmosIndexingPolicy | undefined): IndexingPolicy {
    return {
        ...(expected.indexingMode === undefined ? {} : { indexingMode: actual?.indexingMode }),
        ...(expected.automatic === undefined ? {} : { automatic: actual?.automatic }),
        includedPaths: (actual?.includedPaths ?? []).map(({ path: indexPath }) => ({ path: indexPath })),
        excludedPaths: (actual?.excludedPaths ?? []).map(({ path: indexPath }) => ({ path: indexPath })),
        ...(expected.compositeIndexes === undefined ? {} : { compositeIndexes: actual?.compositeIndexes }),
        ...(actual?.fullTextIndexes?.length
            ? {
                  fullTextIndexes: [...actual.fullTextIndexes].sort((left, right) =>
                      left.path.localeCompare(right.path),
                  ),
              }
            : {}),
    };
}

async function writePortableArtifacts(provisioningPath: string, artifacts: Record<string, string>): Promise<boolean> {
    const divergentArtifacts: string[] = [];
    for (const [name, content] of Object.entries(artifacts)) {
        try {
            const existing = Buffer.from(
                await vscode.workspace.fs.readFile(MigrationProjectService.toUri(provisioningPath, name)),
            ).toString('utf-8');
            if (existing !== content) divergentArtifacts.push(name);
        } catch {
            // Missing artifacts can be created without confirmation.
        }
    }
    if (divergentArtifacts.length > 0) {
        const regenerate = l10n.t('Regenerate');
        const cancel = l10n.t('Cancel');
        const choice = await vscode.window.showWarningMessage(
            l10n.t(
                'Generated provisioning artifacts differ from the canonical model. Regenerate {0}? Existing changes will be replaced.',
                divergentArtifacts.join(', '),
            ),
            { modal: true },
            regenerate,
            cancel,
        );
        if (choice !== regenerate) return false;
    }
    for (const [name, content] of Object.entries(artifacts)) {
        await vscode.workspace.fs.writeFile(
            MigrationProjectService.toUri(provisioningPath, name),
            Buffer.from(content, 'utf-8'),
        );
    }
    return true;
}

// ─── Data-Plane RBAC Propagation Retry ──────────────────────────────

/**
 * Detects the Cosmos DB data-plane authorization error that occurs when a SQL
 * role assignment exists at the control plane but has not yet propagated to the
 * account's data-plane auth cache. Cosmos DB surfaces this as a 403 containing
 * the phrase "cannot be authorized by AAD token in data plane". See:
 * https://aka.ms/cosmos-native-rbac
 */
function isDataPlaneRbacPropagationError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('cannot be authorized by AAD token in data plane');
}

/**
 * Runs a data-plane operation, retrying with linear backoff while Cosmos DB
 * reports that the caller's role assignment has not yet propagated. Role
 * propagation is typically observed within a minute of assignment but can
 * occasionally take a few minutes. We cap total wait at ~3 minutes so a genuine
 * permission issue eventually surfaces to the user.
 *
 * The retried error message (which links to aka.ms/cosmos-native-rbac) is
 * re-thrown unchanged if the cap is exceeded.
 */
async function withDataPlaneRbacRetry<T>(
    operation: () => Promise<T>,
    token: vscode.CancellationToken,
    onRetry: (attempt: number, totalWaitedMs: number) => void | Promise<void>,
): Promise<T> {
    // Wait intervals (ms) between retries. Total ~180s = 3 minutes.
    const waits = [5_000, 10_000, 15_000, 20_000, 30_000, 30_000, 30_000, 40_000];
    let attempt = 0;
    let totalWaitedMs = 0;

    while (true) {
        try {
            return await operation();
        } catch (error) {
            if (!isDataPlaneRbacPropagationError(error) || attempt >= waits.length) {
                throw error;
            }
            const delay = waits[attempt];
            attempt++;
            totalWaitedMs += delay;
            await onRetry(attempt, totalWaitedMs);
            const interruptible = new Promise<void>((resolve) => {
                const t = setTimeout(resolve, delay);
                token.onCancellationRequested(() => {
                    clearTimeout(t);
                    resolve();
                });
            });
            await interruptible;
            if (token.isCancellationRequested) {
                throw error;
            }
        }
    }
}

// ─── Main Entry Point ───────────────────────────────────────────────

/**
 * Phase 4: Provisioning — creates the Cosmos DB database and containers
 * from the Phase 3 model, generates sample data via AI, inserts it,
 * and produces a reusable CosmosDB Shell seed script.
 */
export async function runProvisioning(ctx: Phase4Context, authorization: ProvisioningAuthorization): Promise<void> {
    assertProvisioningAuthorized(authorization);
    const { project, projectService, channel, client, endpoint, armTarget, cancellationToken: token } = ctx;

    await callWithTelemetryAndErrorHandling('cosmosDB.migration.phase4.provisioning', async (context) => {
        setMigrationTelemetryContext(context, project, 'provisioning');
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.forceIncludeInReportIssueCommand = true;
        incrementRunCount(project, 'provisioning');
        const configuredTarget = project.phases.targetEnvironment;
        if (configuredTarget?.type === 'emulator' && !configuredTarget.endpoint) {
            configuredTarget.endpoint = resolveTargetConnection(configuredTarget).endpoint;
        }
        project.phases.provisioning = {
            ...project.phases.provisioning,
            status: 'in-progress',
        };
        await projectService.save(project);

        // Log target environment info. Only OII identifiers under their
        // predefined property names are emitted (`accountName`, `subscriptionId`).
        // The resource group is part of the resource path — do not emit
        // its parts under separate keys; it stays out of telemetry.
        const targetEnv = project.phases.targetEnvironment;
        if (targetEnv) {
            context.telemetry.properties.targetType = targetEnv.type;
            if (targetEnv.type !== 'emulator') {
                const acctName =
                    targetEnv.accountName ||
                    (targetEnv.endpoint ? extractAccountNameFromEndpoint(targetEnv.endpoint) : undefined);
                if (acctName) context.telemetry.properties.accountName = acctName;
                if (targetEnv.subscriptionId) context.telemetry.properties.subscriptionId = targetEnv.subscriptionId;
            }
        }

        // Lazily built on first ARM call. Cached for the lifetime of the phase
        // so we don't re-create the client per DDL operation.
        let cachedMgmtClient: CosmosDBManagementClient | undefined;
        const getMgmtClient = async (): Promise<CosmosDBManagementClient> => {
            if (!armTarget) {
                // Programming error: only call when armTarget is present.
                throw new Error('ARM client requested without armTarget set.');
            }
            if (!cachedMgmtClient) {
                cachedMgmtClient = await createCosmosDBManagementClient(context, armTarget.subscription);
            }
            return cachedMgmtClient;
        };

        try {
            await sendPhaseEvent(channel, 'provisioningStarted');

            const provisioningPath = projectService.getProvisioningPath();
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(provisioningPath));

            // ─── Step 1: Load the model ─────────────────────────────
            const progress = (msg: string) => l10n.t('Provisioning: {message}', { message: msg });

            await sendPhaseProgress(
                channel,
                'Provisioning',
                'provisioningProgress',
                progress(l10n.t('Loading model…')),
            );

            if (token.isCancellationRequested) return;

            const conversionPath = projectService.getSchemaConversionPath();
            const modelPath = path.join(conversionPath, 'model.json');
            let model: CosmosModel;
            try {
                const data = await vscode.workspace.fs.readFile(vscode.Uri.file(modelPath));
                model = JSON.parse(Buffer.from(data).toString('utf-8')) as CosmosModel;
            } catch {
                throw new Error(
                    l10n.t('Could not load model.json from Phase 3. Please complete Schema Conversion first.'),
                );
            }
            const modelValidationErrors = await validatePortableMigrationModel(ext.context.extensionPath, model);
            if (
                modelValidationErrors.length > 0 ||
                !model.databaseName ||
                !model.capacityMode ||
                !Array.isArray(model.containers)
            ) {
                throw new Error(l10n.t('The canonical model is missing required provisioning fields.'));
            }
            const canonicalDatabaseName = model.databaseName;
            context.valuesToMask.push(canonicalDatabaseName, ...model.containers.map((container) => container.name));

            const capacityWarnings: string[] = [];
            const capacityTarget = project.phases.targetEnvironment;
            if (armTarget && capacityTarget) {
                context.valuesToMask.push(armTarget.resourceGroup, armTarget.accountName);
                const account = await (
                    await getMgmtClient()
                ).databaseAccounts.get(armTarget.resourceGroup, armTarget.accountName);
                capacityTarget.capacityMode = account.capabilities?.some(
                    (capability) => capability.name === 'EnableServerless',
                )
                    ? 'serverless'
                    : 'provisioned';
                if (capacityTarget.capacityMode === 'serverless') delete capacityTarget.maxThroughput;
                if (model.capacityMode === 'serverless' && capacityTarget.capacityMode === 'provisioned') {
                    if (capacityTarget.maxThroughput === undefined) {
                        const throughput = await vscode.window.showInputBox({
                            title: l10n.t('Use Provisioned Account'),
                            prompt: l10n.t(
                                'Autoscale maximum RU/s per container. This account is compatible with the serverless design, but ongoing capacity charges apply.',
                            ),
                            value: '1000',
                            validateInput: (value) => {
                                const maximum = Number(value);
                                return Number.isInteger(maximum) && maximum >= 1000 && maximum % 1000 === 0
                                    ? undefined
                                    : l10n.t('Enter a multiple of 1000 RU/s, at least 1000.');
                            },
                        });
                        if (throughput === undefined) return;
                        capacityTarget.maxThroughput = Number(throughput);
                    }
                    capacityWarnings.push(
                        l10n.t(
                            'Using provisioned autoscale at {0} RU/s maximum per container for the serverless design. Ongoing capacity charges apply; the canonical model is unchanged.',
                            capacityTarget.maxThroughput,
                        ),
                    );
                }
                await projectService.save(project);
            }
            for (const container of model.containers) {
                const capacity = await getPortableProvisioningCapacity(
                    ext.context.extensionPath,
                    model,
                    container,
                    capacityTarget,
                );
                if (
                    capacityTarget?.type === 'emulator' &&
                    capacity.capacityMode !== model.capacityMode &&
                    capacityWarnings.length === 0
                ) {
                    capacityWarnings.push(
                        l10n.t(
                            'The emulator uses a different capacity mode from the model. This is a functional test only; production throughput and capacity behavior remain unverified.',
                        ),
                    );
                }
            }
            for (const warning of capacityWarnings) {
                await sendPhaseProgress(channel, 'Provisioning', 'provisioningProgress', progress(warning));
            }
            if (token.isCancellationRequested) return;

            // summary.md is optional context for sample-data generation. If absent
            // (older projects, manual edits) we proceed without it.
            const summaryPath = path.join(conversionPath, 'summary.md');
            let schemaSummary = '';
            try {
                const data = await vscode.workspace.fs.readFile(vscode.Uri.file(summaryPath));
                schemaSummary = Buffer.from(data).toString('utf-8');
            } catch {
                // ignore — summary.md is best-effort additional context
            }

            // ─── Step 2: Generate sample data via AI ────────────────
            // Sample-data generation is AI-driven and slow. If sample-data.json already
            // exists on disk we try to reuse it by comparing file modification times:
            //   • model.json newer than sample-data.json → schema changed, regenerate.
            //   • model.json older/equal → ask the user whether to regenerate.
            context.telemetry.properties.lastStep = 'sampleData';
            const sampleDataPath = path.join(provisioningPath, 'sample-data.json');
            const sampleDataUri = vscode.Uri.file(sampleDataPath);
            const sampleDataExists = await MigrationProjectService.fileExists(sampleDataUri);

            let sampleDataResult: SampleDataResult | undefined;
            let shouldRegenerate = !sampleDataExists;

            if (sampleDataExists) {
                let modelMtime: number | undefined;
                let sampleMtime: number | undefined;
                try {
                    modelMtime = (await vscode.workspace.fs.stat(vscode.Uri.file(modelPath))).mtime;
                    sampleMtime = (await vscode.workspace.fs.stat(sampleDataUri)).mtime;
                } catch {
                    // If either stat fails fall through to regeneration.
                }

                const modelNewer = modelMtime !== undefined && sampleMtime !== undefined && modelMtime > sampleMtime;

                if (modelMtime === undefined || sampleMtime === undefined || modelNewer) {
                    shouldRegenerate = true;
                } else {
                    const regenerate = l10n.t('Regenerate');
                    const reuse = l10n.t('Reuse Existing');
                    const choice = await vscode.window.showInformationMessage(
                        l10n.t(
                            'Sample data already exists and model.json has not changed since it was generated. Regenerate it (slow, AI-driven) or reuse the existing sample-data.json?',
                        ),
                        { modal: true },
                        regenerate,
                        reuse,
                    );

                    if (choice === undefined) {
                        // User cancelled the prompt
                        return;
                    }
                    shouldRegenerate = choice === regenerate;
                }
            }

            if (shouldRegenerate) {
                await sendPhaseProgress(
                    channel,
                    'Provisioning',
                    'provisioningProgress',
                    progress(l10n.t('Generating sample data…')),
                );

                if (token.isCancellationRequested) return;

                const aiModel = await getSelectedModel();
                const sourceType = model.sourceType ?? 'relational';

                const mkDebug = createMkDebug(isDebugPromptsEnabled(), path.join(provisioningPath, 'debug-prompts'));
                const debugConfig: DebugPromptConfig = mkDebug('sample-data-generation');

                const { value: generated, roundsExhausted: sampleDataRoundsExhausted } =
                    await runAgenticLoopWithJsonResult<SampleDataResult>(
                        Phase4SampleDataPrompt,
                        {
                            cosmosModel: JSON.stringify(model),
                            schemaSummary,
                            sourceType,
                            bestPractices: getCosmosDbBestPractices(),
                        },
                        aiModel,
                        getBestPracticeTools(),
                        createToolExecutor({}, '[Provisioning]', undefined, undefined, context),
                        5,
                        token,
                        'Sample Data Generation',
                        l10n.t('Could not parse sample data from AI response.'),
                        debugConfig,
                    );

                if (token.isCancellationRequested) return;

                if (sampleDataRoundsExhausted) {
                    ext.outputChannel.warn(
                        '[migration] Sample-data generation hit tool-round cap; generated data may be incomplete.',
                    );
                }

                sampleDataResult = generated;
            } else {
                await sendPhaseProgress(
                    channel,
                    'Provisioning',
                    'provisioningProgress',
                    progress(l10n.t('Reusing existing sample data…')),
                );

                try {
                    const data = await vscode.workspace.fs.readFile(sampleDataUri);
                    sampleDataResult = JSON.parse(Buffer.from(data).toString('utf-8')) as SampleDataResult;
                } catch (error) {
                    throw new Error(
                        l10n.t(
                            'Could not read existing sample-data.json: {0}',
                            error instanceof Error ? error.message : String(error),
                        ),
                    );
                }
            }

            const sampleDataErrors = await validatePortableSampleData(
                ext.context.extensionPath,
                model,
                sampleDataResult,
            );
            for (const entry of sampleDataResult.sampleData) {
                context.valuesToMask.push(entry.containerName);
                const modelContainer = model.containers.find((container) => container.name === entry.containerName);
                for (const item of entry.items) {
                    if (typeof item.id === 'string' && item.id.length > 0) context.valuesToMask.push(item.id);
                    for (const partitionKey of modelContainer?.partitionKeys ?? []) {
                        const value = item[partitionKey.path.slice(1)];
                        if (typeof value === 'string' && value.length > 0) context.valuesToMask.push(value);
                    }
                }
            }
            if (sampleDataErrors.length > 0) {
                throw new Error(l10n.t('Sample data failed validation: {0}', formatPortableErrors(sampleDataErrors)));
            }
            if (shouldRegenerate) {
                await saveAnalysisFile(provisioningPath, 'sample-data.json', JSON.stringify(sampleDataResult, null, 2));
            }

            // ─── Step 3: Generate deterministic artifacts ───────────
            context.telemetry.properties.lastStep = 'provisioningArtifacts';
            const baseDatabaseName = canonicalDatabaseName;

            await sendPhaseProgress(
                channel,
                'Provisioning',
                'provisioningProgress',
                progress(l10n.t('Generating deployment artifacts…')),
            );

            const generatedArtifacts = await buildPortableProvisioningArtifacts(
                ext.context.extensionPath,
                model,
                sampleDataResult,
                project,
            );
            if (!(await writePortableArtifacts(provisioningPath, generatedArtifacts))) return;
            const seedScriptPath = path.join(provisioningPath, 'seed-data.csh');

            if (token.isCancellationRequested) return;

            // ─── Step 4: Create database ────────────────────────────
            // Cosmos DB's native data-plane RBAC does not expose a data action
            // for creating/deleting databases or containers, so those operations
            // go through ARM (control plane) when the target is an Azure account.
            // The emulator path keeps using the SDK because there is no ARM
            // surface for it.
            context.telemetry.properties.lastStep = 'createDatabase';
            const databaseName = baseDatabaseName;

            await sendPhaseProgress(
                channel,
                'Provisioning',
                'provisioningProgress',
                progress(l10n.t('Creating database "{name}"…', { name: databaseName })),
            );

            if (token.isCancellationRequested) return;

            if (armTarget) {
                const mgmt = await getMgmtClient();
                await mgmt.sqlResources.createUpdateSqlDatabase(
                    armTarget.resourceGroup,
                    armTarget.accountName,
                    databaseName,
                    {
                        resource: { id: databaseName },
                        options: {},
                    },
                );
            } else {
                await withDataPlaneRbacRetry(
                    () => client.databases.createIfNotExists({ id: databaseName }),
                    token,
                    async (_attempt, totalWaitedMs) => {
                        await sendPhaseProgress(
                            channel,
                            'Provisioning',
                            'provisioningProgress',
                            progress(
                                l10n.t(
                                    'Waiting for data-plane role assignment to propagate ({0}s elapsed)…',
                                    Math.round(totalWaitedMs / 1000),
                                ),
                            ),
                        );
                    },
                );
            }
            // Data-plane handle used for item upserts below. Safe to obtain
            // regardless of who created the database.
            const database = client.database(databaseName);

            // ─── Step 5: Create containers ──────────────────────────
            context.telemetry.properties.lastStep = 'createContainers';
            const containersCreated: string[] = [];

            for (const container of model.containers) {
                if (token.isCancellationRequested) return;

                await sendPhaseProgress(
                    channel,
                    'Provisioning',
                    'provisioningProgress',
                    progress(l10n.t('Creating container "{name}"…', { name: container.name })),
                );

                const partitionKeyPaths = container.partitionKeys?.map((pk) => pk.path) ?? ['/id'];
                const capacity = await getPortableProvisioningCapacity(
                    ext.context.extensionPath,
                    model,
                    container,
                    project.phases.targetEnvironment,
                );

                if (armTarget) {
                    const mgmt = await getMgmtClient();
                    await mgmt.sqlResources.createUpdateSqlContainer(
                        armTarget.resourceGroup,
                        armTarget.accountName,
                        databaseName,
                        container.name,
                        {
                            resource: {
                                id: container.name,
                                partitionKey: toArmPartitionKey(partitionKeyPaths),
                                fullTextPolicy: normalizeFullTextPolicy(container.fullTextPolicy),
                                uniqueKeyPolicy: normalizeUniqueKeyPolicy(container.uniqueKeyPolicy),
                                indexingPolicy: container.indexingPolicy
                                    ? toArmIndexingPolicy(container.indexingPolicy)
                                    : undefined,
                            },
                            options:
                                capacity.capacityMode === 'provisioned' && capacity.maxThroughput
                                    ? { autoscaleSettings: { maxThroughput: capacity.maxThroughput } }
                                    : {},
                        },
                    );
                } else {
                    await database.containers.createIfNotExists({
                        id: container.name,
                        partitionKey: {
                            paths: partitionKeyPaths,
                            kind: partitionKeyPaths.length > 1 ? PartitionKeyKind.MultiHash : PartitionKeyKind.Hash,
                            version: PartitionKeyDefinitionVersion.V2,
                        },
                        indexingPolicy: container.indexingPolicy
                            ? toCosmosIndexingPolicy(container.indexingPolicy)
                            : undefined,
                        fullTextPolicy: normalizeFullTextPolicy(container.fullTextPolicy),
                        uniqueKeyPolicy: normalizeUniqueKeyPolicy(container.uniqueKeyPolicy),
                        maxThroughput: capacity.maxThroughput,
                    });
                }

                containersCreated.push(container.name);
            }

            // After creating databases/containers through ARM, the data plane
            // may still be catching up — our freshly-assigned Data Contributor
            // role also needs to propagate. Perform a cheap metadata read
            // against the first container, retrying with backoff, so the
            // subsequent item upserts don't fail the first call.
            if (armTarget && containersCreated.length > 0) {
                await withDataPlaneRbacRetry(
                    () => database.container(containersCreated[0]).read(),
                    token,
                    async (_attempt, totalWaitedMs) => {
                        await sendPhaseProgress(
                            channel,
                            'Provisioning',
                            'provisioningProgress',
                            progress(
                                l10n.t(
                                    'Waiting for data-plane role assignment to propagate ({0}s elapsed)…',
                                    Math.round(totalWaitedMs / 1000),
                                ),
                            ),
                        );
                    },
                );
            }

            // ─── Step 6: Verify containers and insert sample data ──
            // Concurrency batch size for item inserts. Chosen to match the upper
            // bound on concurrent requests most Cosmos accounts handle well while
            // staying well below the SDK's parallelism defaults.
            context.telemetry.properties.lastStep = 'insertData';
            const INSERT_BATCH_SIZE = 50;
            const failures: ProvisioningVerificationReport['failures'] = [];
            const observedContainers: ProvisioningVerificationReport['containers'] = [];
            const sampleItems: ProvisioningVerificationReport['sampleItems'] = [];
            for (const expectedContainer of model.containers) {
                const cosmosContainer = database.container(expectedContainer.name);
                try {
                    const { resource } = await cosmosContainer.read();
                    if (!resource) throw new Error('Container read returned no resource.');
                    const capacity = await getPortableProvisioningCapacity(
                        ext.context.extensionPath,
                        model,
                        expectedContainer,
                        project.phases.targetEnvironment,
                    );
                    let maxThroughput: number | undefined;
                    if (capacity.capacityMode === 'provisioned') {
                        const { resource: offer } = await cosmosContainer.readOffer();
                        maxThroughput = offer?.content?.offerAutopilotSettings?.maxThroughput;
                    }
                    const expectedIndexingPolicy = expectedContainer.indexingPolicy ?? {
                        includedPaths: [],
                        excludedPaths: [],
                    };
                    observedContainers.push({
                        name: resource.id ?? expectedContainer.name,
                        partitionKeys: resource.partitionKey?.paths ?? [],
                        indexingPolicy: observedIndexingPolicy(expectedIndexingPolicy, resource.indexingPolicy),
                        ...(resource.fullTextPolicy === undefined
                            ? {}
                            : { fullTextPolicy: normalizeFullTextPolicy(resource.fullTextPolicy) }),
                        ...(resource.uniqueKeyPolicy === undefined
                            ? {}
                            : { uniqueKeyPolicy: resource.uniqueKeyPolicy }),
                        capacityMode: capacity.capacityMode,
                        ...(maxThroughput === undefined ? {} : { maxThroughput }),
                    });
                } catch (error) {
                    failures.push({
                        operation: 'read-container',
                        resource: expectedContainer.name,
                        code: provisioningFailureCode(error),
                    });
                }
            }
            const uniqueKeyMismatch = model.containers.find((expected) => {
                const observed = observedContainers.find((container) => container.name === expected.name);
                return (
                    observed &&
                    JSON.stringify(normalizeUniqueKeyPolicy(expected.uniqueKeyPolicy)) !==
                        JSON.stringify(normalizeUniqueKeyPolicy(observed.uniqueKeyPolicy))
                );
            });
            if (uniqueKeyMismatch) {
                throw new Error(
                    l10n.t(
                        'Container "{name}" has a different unique-key policy. Changing it requires a new container and an approved data migration.',
                        { name: uniqueKeyMismatch.name },
                    ),
                );
            }
            for (const entry of sampleDataResult.sampleData) {
                if (token.isCancellationRequested) return;

                const cosmosContainer = database.container(entry.containerName);

                await sendPhaseProgress(
                    channel,
                    'Provisioning',
                    'provisioningProgress',
                    progress(
                        l10n.t('Inserting {count} items into "{name}"…', {
                            count: entry.items.length,
                            name: entry.containerName,
                        }),
                    ),
                );

                // Use `upsert` (not `create`) so re-running provisioning against
                // an already-populated database is idempotent rather than
                // failing every item with a 409 conflict.
                // `Promise.allSettled` ensures a single failed item does not
                // abort the remaining inserts in the same batch.
                for (let i = 0; i < entry.items.length; i += INSERT_BATCH_SIZE) {
                    if (token.isCancellationRequested) return;
                    const batch = entry.items.slice(i, i + INSERT_BATCH_SIZE);
                    const results = await Promise.allSettled(batch.map((item) => cosmosContainer.items.upsert(item)));
                    for (const [resultIndex, result] of results.entries()) {
                        if (result.status === 'rejected') {
                            const item = batch[resultIndex];
                            failures.push({
                                operation: 'upsert-item',
                                resource: `${entry.containerName}/${String(item.id)}`,
                                code: provisioningFailureCode(result.reason),
                            });
                        }
                    }
                }

                const modelContainer = model.containers.find((container) => container.name === entry.containerName)!;
                for (const item of entry.items) {
                    const partitionKeyValues = (modelContainer.partitionKeys ?? []).map(
                        (partitionKey) => item[partitionKey.path.slice(1)],
                    );
                    let found = false;
                    let document: Record<string, unknown> | undefined;
                    try {
                        const partitionKey = (
                            partitionKeyValues.length === 1 ? partitionKeyValues[0] : partitionKeyValues
                        ) as PartitionKey;
                        const response = await cosmosContainer
                            .item(String(item.id), partitionKey)
                            .read<Record<string, unknown>>();
                        found = response.resource !== undefined;
                        document = response.resource;
                    } catch (error) {
                        failures.push({
                            operation: 'read-item',
                            resource: `${entry.containerName}/${String(item.id)}`,
                            code: provisioningFailureCode(error),
                        });
                    }
                    sampleItems.push({
                        containerName: entry.containerName,
                        id: String(item.id),
                        partitionKeyValues,
                        found,
                        ...(document === undefined ? {} : { document }),
                    });
                }
            }

            // ─── Step 7: Persist and validate observed evidence ─────
            const targetEnvironment = project.phases.targetEnvironment!;
            const verifiedAt = new Date().toISOString();
            const verificationReport: ProvisioningVerificationReport = {
                version: 1,
                verifiedAt,
                modelSha256: await hashPortableMigrationModel(ext.context.extensionPath, model),
                target: {
                    type: targetEnvironment.type,
                    endpoint: new URL(endpoint).origin,
                    ...(targetEnvironment.accountName === undefined
                        ? {}
                        : { accountName: targetEnvironment.accountName }),
                },
                databaseName,
                containers: observedContainers,
                sampleItems,
                failures,
            };
            await saveAnalysisFile(
                provisioningPath,
                'provisioning-verification.json',
                JSON.stringify(verificationReport, null, 2),
            );
            const verificationErrors = await validatePortableProvisioningVerification(
                ext.context.extensionPath,
                model,
                sampleDataResult,
                project,
                verificationReport,
            );
            if (verificationErrors.length > 0) {
                throw new Error(
                    l10n.t('Provisioning verification failed: {0}', formatPortableErrors(verificationErrors)),
                );
            }

            // ─── Step 8: Update project state ───────────────────────
            context.telemetry.properties.lastStep = 'updateProjectState';
            targetEnvironment.verified = true;
            targetEnvironment.verifiedAt = verifiedAt;
            project.phases.provisioning = {
                ...project.phases.provisioning,
                status: 'complete',
                databaseName,
                containersCreated,
                sampleDataInserted: true,
                completedAt: new Date().toISOString(),
            };
            await projectService.save(project);

            // Structural metrics
            context.telemetry.measurements.containersCreated = containersCreated.length;

            await sendPhaseEvent(channel, 'provisioningCompleted', [
                {
                    databaseName,
                    containersCreated,
                    seedScriptPath,
                    warnings: capacityWarnings,
                } satisfies ProvisioningResult,
            ]);
        } catch (error) {
            if (token.isCancellationRequested) throw new vscode.CancellationError();

            enrichErrorContext(context, error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.error(`[Migration] Provisioning failed: ${errorMessage}`);
            if (error instanceof Error && error.stack) {
                ext.outputChannel.debug(error.stack);
            }
            await sendPhaseEvent(channel, 'provisioningError', [errorMessage]);
            throw error;
        }
    });
}

// ─── Connection Testing ─────────────────────────────────────────────

/**
 * Tests the connection to the target Cosmos DB environment (emulator or Azure).
 * If an RBAC permission error is detected for a non-emulator target, prompts
 * the user to assign the Data Contributor role and retries.
 */
export async function testConnection(ctx: Phase4BaseContext, subscription?: AzureSubscription): Promise<void> {
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

// ─── Sample Data Population ─────────────────────────────────────────

/**
 * Creates a Cosmos DB client for the target environment and runs provisioning.
 */
export async function populateSampleData(
    ctx: Phase4BaseContext,
    provisioningCancellation: vscode.CancellationTokenSource,
    authorization: ProvisioningAuthorization,
): Promise<void> {
    assertProvisioningAuthorized(authorization);
    await callWithTelemetryAndErrorHandling('cosmosDB.migration.phase4.sampleDataPopulation', async (context) => {
        const { project, projectService, channel } = ctx;
        if (!project || !projectService) return;
        setMigrationTelemetryContext(context, project, 'provisioning');
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.forceIncludeInReportIssueCommand = true;

        const target = project.phases.targetEnvironment;
        if (!target?.verified) return;

        const { endpoint, credentials, isEmulator } = resolveTargetConnection(target);
        const client = getCosmosClient(endpoint, credentials, isEmulator);

        // For Azure-hosted targets, resolve the ARM coordinates so database
        // and container DDL can go through the control plane (the data plane
        // has no RBAC data action for those operations). The emulator has no
        // ARM surface, so `armTarget` is left undefined there.
        let armTarget: Phase4Context['armTarget'] | undefined;
        if (!isEmulator && target.subscriptionId && target.resourceGroup && target.accountName) {
            try {
                const subscriptionProvider = new VSCodeAzureSubscriptionProvider();
                const subscriptions = await subscriptionProvider.getSubscriptions(false);
                const subscription = subscriptions.find((s) => s.subscriptionId === target.subscriptionId);
                if (subscription) {
                    armTarget = {
                        subscription,
                        resourceGroup: target.resourceGroup,
                        accountName: target.accountName,
                    };
                } else {
                    ext.outputChannel.warn(
                        `[Migration] Could not find signed-in subscription ${target.subscriptionId}; ` +
                            'database and container creation will attempt the data plane and likely fail.',
                    );
                }
            } catch (error) {
                ext.outputChannel.warn(
                    `[Migration] Failed to resolve Azure subscription for provisioning: ${parseError(error).message}`,
                );
            }
        }

        await runProvisioning(
            {
                project,
                projectService,
                channel,
                client,
                endpoint,
                armTarget,
                cancellationToken: provisioningCancellation.token,
            },
            authorization,
        );
    });
}

// ─── Cancellation ───────────────────────────────────────────────────

export async function cancelProvisioning(
    cancellation: vscode.CancellationTokenSource | undefined,
    channel: TypedEventSink<MigrationEvent>,
): Promise<vscode.CancellationTokenSource | undefined> {
    cancellation?.cancel();
    cancellation?.dispose();
    await sendPhaseEvent(channel, 'provisioningCancelled');
    return undefined;
}

export async function cancelAccountProvisioning(
    cancellation: vscode.CancellationTokenSource | undefined,
    channel: TypedEventSink<MigrationEvent>,
): Promise<vscode.CancellationTokenSource | undefined> {
    cancellation?.cancel();
    cancellation?.dispose();
    await sendPhaseEvent(channel, 'accountProvisioningCancelled');
    return undefined;
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
 * Sanitize indexing policy paths: replace non-terminal asterisk (invalid array
 * traversal) with bracket notation. Cosmos DB only accepts /[]/ for array
 * traversal; asterisk is valid only as the final (terminal) path segment.
 *
 * E.g. "/lineItems/STAR/productSnapshot/?" becomes "/lineItems/[]/productSnapshot/?"
 */
function sanitizeIndexingPaths(paths: { path: string }[]): { path: string }[] {
    return paths.map(({ path: p }) => ({
        path: p.replace(/\/\*\//g, '/[]/'),
    }));
}

/**
 * Convert our CosmosModel IndexingPolicy to the @azure/cosmos SDK format.
 */
function toCosmosIndexingPolicy(policy: NonNullable<IndexingPolicy>): CosmosIndexingPolicy {
    return {
        indexingMode: (policy.indexingMode ?? 'consistent') as CosmosIndexingPolicy['indexingMode'],
        automatic: policy.automatic ?? true,
        includedPaths: sanitizeIndexingPaths(policy.includedPaths),
        excludedPaths: sanitizeIndexingPaths(policy.excludedPaths),
        compositeIndexes: policy.compositeIndexes,
        fullTextIndexes: policy.fullTextIndexes,
    };
}

/**
 * Convert our CosmosModel IndexingPolicy to the @azure/arm-cosmosdb format.
 * The shape is nearly identical to the data-plane SDK's, but lives in a
 * different module so the types are structurally but not nominally compatible.
 */
function toArmIndexingPolicy(policy: NonNullable<IndexingPolicy>): ArmIndexingPolicy {
    return {
        indexingMode: policy.indexingMode ?? 'consistent',
        automatic: policy.automatic ?? true,
        includedPaths: sanitizeIndexingPaths(policy.includedPaths),
        excludedPaths: sanitizeIndexingPaths(policy.excludedPaths),
        compositeIndexes: policy.compositeIndexes,
        fullTextIndexes: policy.fullTextIndexes,
    };
}

/**
 * Build an ARM-side partition-key definition from the set of key paths we
 * collected during schema conversion. Uses MultiHash when more than one path
 * is present; otherwise falls back to Hash. Always emits version 2 (large
 * partition keys).
 */
function toArmPartitionKey(paths: string[]): ArmContainerPartitionKey {
    return {
        paths,
        kind: paths.length > 1 ? 'MultiHash' : 'Hash',
        version: 2,
    };
}

// ─── Bicep Export Refinement ────────────────────────────────────────

/**
 * Merge user-supplied provisioning details (subscription / resource group /
 * location selected via `selectResourceGroup`, account name entered before
 * provisioning) into the generated `main.bicepparam`.
 *
 * Always rewrites `main.bicepparam` so the latest picks are reflected.
 * Existing values in the file (including any manual user edits) are preserved
 * unless overridden by `partial`.
 *
 * Resilient to user edits and deletions: if either `main.bicep` or
 * `main.bicepparam` is missing it is silently regenerated from the current
 * `model.json` so users who deleted the export between phases still get a
 * usable artifact.
 */
export async function refineBicepParams(ctx: Phase4BaseContext, partial: BicepParamValues): Promise<void> {
    const { projectService } = ctx;

    try {
        const bicepUri = vscode.Uri.file(projectService.getBicepPath());
        const paramsUri = vscode.Uri.file(projectService.getBicepParamPath());

        // Load the model — needed both to (re)generate `main.bicep` if it's
        // missing and to derive a sensible `databaseName` default for params.
        let model: CosmosModel | undefined;
        try {
            const conversionPath = projectService.getSchemaConversionPath();
            const modelPath = path.join(conversionPath, 'model.json');
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(modelPath));
            model = JSON.parse(Buffer.from(data).toString('utf-8')) as CosmosModel;
        } catch {
            // No model on disk — refinement effectively a no-op; the user will
            // see the standard "complete Phase 3 first" path elsewhere.
            return;
        }

        // Regenerate `main.bicep` if the user removed it.
        let bicepExists = true;
        try {
            await vscode.workspace.fs.stat(bicepUri);
        } catch {
            bicepExists = false;
        }
        if (!bicepExists) {
            await vscode.workspace.fs.writeFile(bicepUri, Buffer.from(buildBicepTemplate(model), 'utf-8'));
        }

        // Read existing params (if any) and merge new values.
        let existingParams: string | undefined;
        try {
            const data = await vscode.workspace.fs.readFile(paramsUri);
            existingParams = Buffer.from(data).toString('utf-8');
        } catch {
            // missing — fall through to a fresh write
        }

        const merged = existingParams
            ? mergeBicepParams(existingParams, partial)
            : buildBicepParams({ databaseName: model.databaseName, ...partial });

        await vscode.workspace.fs.writeFile(paramsUri, Buffer.from(merged, 'utf-8'));
    } catch (error) {
        // Bicep refinement is a non-critical export; never fail the user's
        // primary flow because of it.
        ext.outputChannel.warn(
            `[migration] Failed to refine Bicep params: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

// ─── Account Provisioning (Azure SDK) ───────────────────────────────

/**
 * Provisions a new Azure Cosmos DB account using the Azure SDK
 * (`@azure/arm-cosmosdb`). Returns the account endpoint on success.
 */
export async function provisionAccount(
    ctx: Phase4BaseContext,
    resourceGroup: string,
    accountName: string,
    location: string,
    subscription: AzureSubscription,
    authorization: ProvisioningAuthorization,
    token?: vscode.CancellationToken,
): Promise<string | undefined> {
    assertProvisioningAuthorized(authorization);
    const { project, projectService, channel } = ctx;

    return callWithTelemetryAndErrorHandling('cosmosDB.migration.phase4.accountProvisioning', async (context) => {
        if (!project || !projectService) return undefined;
        setMigrationTelemetryContext(context, project, 'provisioning');
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.forceIncludeInReportIssueCommand = true;

        await sendPhaseEvent(channel, 'accountProvisioningStarted');

        try {
            // Defense in depth: the webview disables the provision button for invalid
            // names, but validate again here to fail fast with a clear message instead
            // of letting the Azure SDK reject the request with a less-friendly error.
            const accountNameError = validateCosmosDBAccountName(accountName);
            if (accountNameError) {
                throw new Error(accountNameError);
            }

            // A missing resource group or location produces a malformed ARM URL
            // (e.g. `/resourceGroups//providers/...`) that ARM dispatches to the
            // generic Microsoft.Resources provider, which rejects the request
            // with a misleading "InvalidApiVersionParameter" error instead of a
            // useful "resource group missing" one. Catch this up-front.
            if (!resourceGroup) {
                throw new Error(
                    l10n.t('No resource group selected. Please pick a resource group before provisioning.'),
                );
            }
            if (!location) {
                throw new Error(l10n.t('No location selected. Please pick a location before provisioning.'));
            }

            // Read the model to determine the capacity mode (serverless vs provisioned)
            let capacityMode: 'serverless' | 'provisioned' = 'serverless';
            try {
                const conversionPath = projectService.getSchemaConversionPath();
                const modelPath = path.join(conversionPath, 'model.json');
                const data = await vscode.workspace.fs.readFile(vscode.Uri.file(modelPath));
                const model = JSON.parse(Buffer.from(data).toString('utf-8')) as CosmosModel;
                if (model.capacityMode === 'provisioned') {
                    capacityMode = 'provisioned';
                }
            } catch {
                // Fall back to serverless if model cannot be read
            }

            await sendPhaseProgress(
                channel,
                'Provisioning',
                'accountProvisioningProgress',
                l10n.t(
                    'Creating {0} Cosmos DB account "{1}"…',
                    capacityMode === 'serverless' ? l10n.t('serverless') : l10n.t('provisioned'),
                    accountName,
                ),
            );

            const mgmtClient = await createCosmosDBManagementClient(context, subscription);

            // Pre-flight: Cosmos DB account names are globally unique. Calling
            // `beginCreateOrUpdate` with a taken name either silently updates an
            // existing account in this subscription or fails with an opaque
            // error when the conflict is in someone else's subscription. Detect
            // both cases up-front so we can offer a sensible recovery path.
            const reuseExistingAccount = await detectExistingAccountConflict(mgmtClient, accountName, channel);
            if (reuseExistingAccount === 'cancel') {
                return undefined;
            }

            // The user may have asked to reuse an existing account that lives in a
            // different resource group than the one selected during phase 4. Honor
            // the live account's RG for everything that follows (RBAC scope,
            // project state) so we point at the actual resource.
            const effectiveResourceGroup = reuseExistingAccount?.resourceGroup ?? resourceGroup;
            const effectiveLocation = reuseExistingAccount?.location ?? location;

            let endpoint: string | undefined;

            if (reuseExistingAccount) {
                await sendPhaseProgress(
                    channel,
                    'Provisioning',
                    'accountProvisioningProgress',
                    l10n.t('Reusing existing Cosmos DB account "{0}"…', accountName),
                );
                endpoint = reuseExistingAccount.endpoint;
                if (!endpoint) {
                    // `databaseAccounts.list()` may omit `documentEndpoint` on
                    // some accounts; fetch the full resource to be sure.
                    const fullAccount = await mgmtClient.databaseAccounts.get(effectiveResourceGroup, accountName);
                    endpoint = fullAccount.documentEndpoint;
                }
            } else {
                // Bridge the VS Code CancellationToken to an AbortController so the ARM SDK
                // stops polling (and rejects with an AbortError) when the user cancels. The
                // in-progress Azure-side deployment is not torn down — only our wait is.
                const abortController = new AbortController();
                const cancellationListener = token?.onCancellationRequested(() => abortController.abort());

                const result = await mgmtClient.databaseAccounts
                    .createOrUpdate(
                        resourceGroup,
                        accountName,
                        {
                            location,
                            databaseAccountOfferType: 'Standard',
                            locations: [{ locationName: location, failoverPriority: 0, isZoneRedundant: false }],
                            kind: 'GlobalDocumentDB',
                            capabilities: capacityMode === 'serverless' ? [{ name: 'EnableServerless' }] : [],
                            disableLocalAuth: true,
                        },
                        { abortSignal: abortController.signal },
                    )
                    .finally(() => {
                        cancellationListener?.dispose();
                    });

                if (token?.isCancellationRequested) {
                    // Cancelled while we were waiting; the cancel handler already emitted
                    // `accountProvisioningCancelled`, so just exit quietly.
                    return undefined;
                }

                endpoint = result.documentEndpoint;
            }

            if (!endpoint) {
                throw new Error(l10n.t('Account was created but no endpoint was returned.'));
            }

            // Save the endpoint to the project. Also persist the subscription's
            // tenantId so that connection tests acquire an AAD token from the
            // tenant that owns the account — the signed-in user's default tenant
            // may differ and would be rejected by the account's auth policy.
            //
            // When reusing an existing account, mark the target as `'azure'` so
            // the UI flips to the "Azure Cosmos DB Account" view (matching the
            // flow of picking an account via `selectAccount`). The user can then
            // test the connection and proceed without going through provisioning
            // again. Newly-created accounts keep `'provision'` so phase 4
            // continues to attribute the account to this migration.
            const isReuse = reuseExistingAccount !== undefined;
            project.phases.targetEnvironment = {
                ...project.phases.targetEnvironment,
                type: isReuse ? 'azure' : 'provision',
                endpoint,
                accountName,
                resourceGroup: effectiveResourceGroup,
                location: effectiveLocation,
                subscriptionId: subscription.subscriptionId,
                subscriptionName: subscription.name,
                tenantId: subscription.tenantId,
                verified: false,
            };
            await projectService.save(project);

            if (isReuse) {
                // Mirror the `selectAccount` flow so the webview switches to the
                // "Azure Cosmos DB Account" option pre-filled with this endpoint.
                // `accountProvisioningCancelled` resets the provisioning UI state
                // (no "completed" banner) since we did not actually create anything.
                await sendPhaseEvent(channel, 'accountSelected', [{ endpoint, accountName }]);
                await sendPhaseEvent(channel, 'accountProvisioningCancelled');
                // Skip auto RBAC assignment and the auto-test in the caller —
                // existing accounts already have role assignments managed by
                // their owner; if the user is missing access, the test-connection
                // flow surfaces and offers to fix it on demand.
                return undefined;
            }

            // Auto-assign data plane (Data Contributor) and control plane (Cosmos DB Operator)
            // RBAC roles to the signed-in user. Best-effort; failures are surfaced but non-fatal.
            await assignRbacAfterProvisioning(channel, accountName, effectiveResourceGroup, context, subscription);

            await sendPhaseEvent(channel, 'accountProvisioningCompleted', [{ endpoint }]);
            return endpoint;
        } catch (error) {
            if (token?.isCancellationRequested) {
                // User-initiated cancel; `cancelAccountProvisioning` has already emitted
                // the cancelled event and the Azure SDK surfaces the abort as an error.
                throw new vscode.CancellationError();
            }
            enrichErrorContext(context, error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            // ARM SDK errors are `RestError` instances with extra fields that
            // identify the exact failing request (URL, HTTP method, status,
            // x-ms-request-id). Surface them so we can tell which call along
            // the create→poll→GET chain actually failed.
            const restDetails = (() => {
                if (!error || typeof error !== 'object') return '';
                const e = error as {
                    statusCode?: number;
                    code?: string;
                    request?: { url?: string; method?: string };
                    response?: { status?: number; headers?: { get?: (name: string) => string | undefined } };
                };
                const parts: string[] = [];
                const method = e.request?.method;
                const url = e.request?.url;
                if (method || url) parts.push(`${method ?? '?'} ${url ?? '?'}`);
                const status = e.statusCode ?? e.response?.status;
                if (status !== undefined) parts.push(`status=${status}`);
                if (e.code) parts.push(`code=${e.code}`);
                const requestId = e.response?.headers?.get?.('x-ms-request-id');
                if (requestId) parts.push(`x-ms-request-id=${requestId}`);
                return parts.length ? ` [${parts.join(' ')}]` : '';
            })();
            ext.outputChannel.error(`[Migration] Account provisioning failed: ${errorMessage}${restDetails}`);
            await sendPhaseEvent(channel, 'accountProvisioningError', [errorMessage]);
            throw error;
        }
    });
}

// ─── RBAC Helpers ───────────────────────────────────────────────────

/**
 * Checks whether a Cosmos DB account with `accountName` already exists. When it
 * does, asks the user whether to reuse it or cancel and pick a different name.
 *
 * Cosmos DB account names are globally unique. The conflict can be in:
 *  - the user's own subscription (we can offer to reuse the account)
 *  - some other subscription/tenant (the user must pick a different name)
 *
 * Side effects: emits `accountProvisioningCancelled` (user-cancel) or
 * `accountProvisioningError` (name taken globally) so the webview reflects the
 * outcome without the caller having to coordinate event emission.
 *
 * Return values:
 *  - `'cancel'`            — user dismissed; caller should abort
 *  - `undefined`           — no conflict; caller should create the account
 *  - `{ resourceGroup, … }` — reuse existing account at the returned coords
 */
async function detectExistingAccountConflict(
    mgmtClient: CosmosDBManagementClient,
    accountName: string,
    channel: TypedEventSink<MigrationEvent>,
): Promise<'cancel' | undefined | { resourceGroup: string; endpoint?: string; location?: string }> {
    const exists = (await mgmtClient.databaseAccounts.checkNameExists(accountName)).body;
    if (!exists) {
        return undefined;
    }

    // Look up the account in the user's subscription. `list()` enumerates
    // across resource groups so we don't have to know the RG up-front and can
    // honor a reuse request even when the user picked a different RG in the UI.
    let existingInSubscription: { resourceGroup: string; endpoint?: string; location?: string } | undefined;
    for await (const account of mgmtClient.databaseAccounts.list()) {
        if (account.name?.toLowerCase() === accountName.toLowerCase() && account.id) {
            existingInSubscription = {
                resourceGroup: getResourceGroupFromId(account.id),
                endpoint: account.documentEndpoint,
                location: account.location,
            };
            break;
        }
    }

    if (!existingInSubscription) {
        // Conflict is in another subscription/tenant — the user cannot reuse it.
        const errorMessage = l10n.t(
            'A Cosmos DB account named "{0}" already exists in another Azure subscription. Account names must be globally unique; please choose a different name.',
            accountName,
        );
        await sendPhaseEvent(channel, 'accountProvisioningError', [errorMessage]);
        return 'cancel';
    }

    const reuseItem: vscode.MessageItem = { title: l10n.t('Reuse Account') };
    const cancelItem: vscode.MessageItem = { title: l10n.t('Cancel'), isCloseAffordance: true };
    const choice = await vscode.window.showWarningMessage(
        l10n.t(
            'A Cosmos DB account named "{0}" already exists in resource group "{1}". Reuse it, or cancel and choose a different name?',
            accountName,
            existingInSubscription.resourceGroup,
        ),
        { modal: true },
        reuseItem,
        cancelItem,
    );

    if (choice !== reuseItem) {
        await sendPhaseEvent(channel, 'accountProvisioningCancelled');
        return 'cancel';
    }

    return existingInSubscription;
}

/**
 * Silently assigns post-provisioning RBAC roles to the signed-in user:
 *  - "Cosmos DB Built-in Data Contributor" (data plane, built-in `000...002`) —
 *    grants read/write access to items inside existing containers.
 *  - "Cosmos DB Operator" (Azure RBAC, built-in) at resource group scope —
 *    grants the ability to create, modify, and delete databases and
 *    containers. Cosmos DB's native RBAC does not expose a data action for
 *    database/container lifecycle (the `sqlDatabases/*` wildcard is rejected
 *    by the service), so this control-plane Azure RBAC role is required.
 *
 * Failures are non-blocking: the account was created successfully and the user can
 * always assign the missing roles manually.
 */
async function assignRbacAfterProvisioning(
    channel: TypedEventSink<MigrationEvent>,
    accountName: string,
    resourceGroup: string,
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<void> {
    await sendPhaseProgress(
        channel,
        'Provisioning',
        'accountProvisioningProgress',
        l10n.t('Assigning RBAC permissions…'),
    );

    let principalId: string | undefined;
    try {
        principalId = await getSignedInPrincipalIdForSubscription(subscription);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        ext.outputChannel.warn(
            `[Migration] Could not resolve signed-in principal ID for RBAC assignment: ${errorMessage}`,
        );
    }

    if (!principalId) {
        ext.outputChannel.warn(
            '[Migration] Could not resolve signed-in principal ID for RBAC assignment. ' +
                'User may need to assign the "Cosmos DB Built-in Data Contributor" and "Cosmos DB Operator" roles manually.',
        );
        const learnMoreItem: vscode.MessageItem = { title: l10n.t('Learn More') };
        void vscode.window
            .showWarningMessage(
                l10n.t(
                    'Account was created but RBAC role assignment was skipped because the signed-in principal could not be resolved. You may need to assign the "Cosmos DB Built-in Data Contributor" and "Cosmos DB Operator" roles manually. See output for details.',
                ),
                learnMoreItem,
            )
            .then((item) => {
                if (item === learnMoreItem) {
                    void vscode.env.openExternal(vscode.Uri.parse('https://aka.ms/cosmos-native-rbac'));
                }
            });
        return;
    }

    // Data plane and control plane role assignments are independent: a failure in one
    // must not prevent the other from being attempted. Run them concurrently and
    // report failures individually. Both are best-effort — the account was created
    // successfully and the user can always assign missing roles manually.
    const dataPlanePromise = (async () => {
        try {
            // Skip the create call if the role is already assigned (e.g.
            // when reusing an existing account). Saves an ARM round-trip
            // and avoids creating a duplicate assignment with a fresh UUID.
            if (
                await hasDataContributorRoleAssignment(accountName, principalId, resourceGroup, context, subscription)
            ) {
                ext.outputChannel.appendLog(
                    `[Migration] Principal ${principalId} already has the Data Contributor role on account ${accountName}; skipping assignment.`,
                );
                return;
            }
            await addRbacContributorPermission(accountName, principalId, resourceGroup, context, subscription);
            ext.outputChannel.appendLog(
                `[Migration] Successfully assigned Data Contributor role to principal ${principalId} on account ${accountName}.`,
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.warn(
                `[Migration] Data Contributor role assignment failed (non-blocking): ${errorMessage}`,
            );
            const learnMoreItem: vscode.MessageItem = { title: l10n.t('Learn More') };
            void vscode.window
                .showWarningMessage(
                    l10n.t(
                        'Account was created but assigning the "Cosmos DB Built-in Data Contributor" data-plane role failed. You may need to assign it manually to read/write data. See output for details.',
                    ),
                    learnMoreItem,
                )
                .then((item) => {
                    if (item === learnMoreItem) {
                        void vscode.env.openExternal(vscode.Uri.parse('https://aka.ms/cosmos-native-rbac'));
                    }
                });
        }
    })();

    const controlPlanePromise = (async () => {
        try {
            if (await hasCosmosDBOperatorRoleAssignment(principalId, resourceGroup, context, subscription)) {
                ext.outputChannel.appendLog(
                    `[Migration] Principal ${principalId} already has the Cosmos DB Operator role on resource group ${resourceGroup}; skipping assignment.`,
                );
                return;
            }
            await addCosmosDBOperatorRoleAssignment(principalId, resourceGroup, context, subscription);
            ext.outputChannel.appendLog(
                `[Migration] Successfully assigned Cosmos DB Operator role to principal ${principalId} on resource group ${resourceGroup}.`,
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.warn(
                `[Migration] Cosmos DB Operator role assignment failed (non-blocking): ${errorMessage}`,
            );
            void vscode.window.showWarningMessage(
                l10n.t(
                    'Account was created but assigning the "Cosmos DB Operator" control-plane role failed. You may need to assign it manually to create databases and containers. See output for details.',
                ),
            );
        }
    })();

    await Promise.all([dataPlanePromise, controlPlanePromise]);
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
