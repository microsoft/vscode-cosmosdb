/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TypedEventSink } from '@cosmosdb/webview-rpc';
import { type ProjectJson } from '../../../services/MigrationProjectService';
import { type ModelInfo } from '../../../utils/modelUtils';
import { type ProvisioningResult } from '../../migration/steps/phase4Provisioning';
import { migrationProcedure, migrationRouter } from '../trpc';

// ─── Per-event Payload Shapes ───────────────────────────────────────────────
//
// All migration events flow extension → webview through a single tRPC
// subscription. Events are encoded as `{ type: 'event', name, params }` where
// `name` discriminates the union and `params` is a tuple matching the named
// event's signature. Producers (`sendPhaseEvent`, `eventSink.emit`) and
// consumers (`MigrationChannel.on`) are typed against this union so a
// misspelled name or a wrong payload is a compile error.

export interface AnalysisResultPayload {
    projectName?: string;
    projectType?: string;
    language?: string;
    frameworks?: string[];
    databaseType?: string;
    databaseAccess?: string;
}

export interface AssessmentResultPayload {
    domainFiles: {
        name: string;
        tables: string[];
        filePath: string;
        isMapped: boolean;
        estimatedTokens: number;
    }[];
    summaryFilePath: string;
}

export interface SchemaConversionResultPayload {
    domains: {
        name: string;
        containers: number;
        entities: number;
        summaryFilePath: string;
        modelFilePath: string;
    }[];
    mergedModelFilePath: string;
    summaryFilePath: string;
}

export interface ProjectLoadedPayload {
    project: ProjectJson | undefined;
    workspacePath: string;
    schemaFiles: string[];
    volumetricFiles: string[];
    accessPatternFiles: string[];
    excludedSchemaFiles: string[];
    excludedVolumetricFiles: string[];
    excludedAccessPatternFiles: string[];
    hasDiscoveryReport: boolean;
    hasAssessmentSummary: boolean;
    assessmentResult: AssessmentResultPayload | null;
    hasSchemaConversion: boolean;
    schemaConversionResult: SchemaConversionResultPayload | null;
    hasSampleData: boolean;
    hasBicep: boolean;
    hasVolumetricsTemplate: boolean;
    hasAccessPatternsTemplate: boolean;
    isAIFeaturesEnabled: boolean;
    consentGiven: boolean;
    hasCodeMigrationPlan: boolean;
    codeMigrationPlanPath: string;
    isPhase4Required: boolean;
    showTokenEstimate: boolean;
}

export interface FilesChangedPayload {
    schemaFiles: string[];
    volumetricFiles: string[];
    accessPatternFiles: string[];
    excludedSchemaFiles: string[];
    excludedVolumetricFiles: string[];
    excludedAccessPatternFiles: string[];
    hasVolumetricsTemplate: boolean;
    hasAccessPatternsTemplate: boolean;
    hasDiscoveryReport: boolean;
    hasAssessmentSummary: boolean;
    hasSchemaConversion: boolean;
    hasSampleData: boolean;
    hasBicep: boolean;
    hasCodeMigrationPlan: boolean;
    codeMigrationPlanPath: string;
    fileStateGeneration: number;
}

export interface TokenEstimatePayload {
    minTokens: number;
    maxTokens: number;
    modelMaxTokens: number;
    estimateGeneration: number;
}

export interface AzureLocation {
    name: string;
    displayName: string;
}

export interface AccountSelectedPayload {
    endpoint: string;
    accountName: string;
}

export interface ResourceGroupSelectedPayload {
    subscriptionId: string;
    subscriptionName: string;
    resourceGroup: string;
    location: string;
    locationDisplayName: string;
}

export interface AccountProvisioningCompletedPayload {
    endpoint: string;
}

export type ConnectionTestResultPayload =
    | { success: true }
    | { success: false; error: string; documentationUrl: string | undefined };

// ─── Event Payload Map ──────────────────────────────────────────────────────

export type MigrationEventPayloads = {
    // Discovery / Phase 1
    analysisStarted: [];
    analysisCompleted: [result: AnalysisResultPayload];
    analysisError: [error: string];
    analysisCancelled: [];
    discoveryStarted: [];
    discoveryCompleted: [];
    discoveryError: [error: string];
    discoveryCancelled: [];

    // Assessment / Phase 2
    assessmentStarted: [];
    assessmentProgress: [message: string];
    assessmentCompleted: [result: AssessmentResultPayload];
    assessmentError: [error: string];
    assessmentCancelled: [];

    // Schema conversion / Phase 3
    schemaConversionStarted: [];
    schemaConversionProgress: [message: string];
    schemaConversionCompleted: [result: SchemaConversionResultPayload];
    schemaConversionError: [error: string];
    schemaConversionCancelled: [];

    // Provisioning / Phase 4
    provisioningStarted: [];
    provisioningProgress: [message: string];
    provisioningCompleted: [result: ProvisioningResult];
    provisioningError: [error: string];
    provisioningCancelled: [];

    // Account provisioning (sub-flow of Phase 4)
    accountProvisioningStarted: [];
    accountProvisioningProgress: [message: string];
    accountProvisioningCompleted: [result: AccountProvisioningCompletedPayload];
    accountProvisioningError: [error: string];
    accountProvisioningCancelled: [];

    // Target environment
    accountSelected: [data: AccountSelectedPayload];
    resourceGroupSelected: [data: ResourceGroupSelectedPayload];
    locationsList: [locations: AzureLocation[]];
    connectionTestStarted: [];
    connectionTestProgress: [message: string];
    connectionTestResult: [result: ConnectionTestResultPayload];

    // Project / file state
    projectLoaded: [data: ProjectLoadedPayload];
    filesChanged: [data: FilesChangedPayload];

    // Git
    gitStatus: [hasGit: boolean];
    gitignoreStatus: [isInGitignore: boolean];

    // AI / models
    availableModels: [models: ModelInfo[], savedModelId: string | null];
    aiFeaturesEnabledChanged: [available: boolean];
    tokenEstimate: [estimate: TokenEstimatePayload | null];
    showTokenEstimateChanged: [enabled: boolean];
};

export type MigrationEventName = keyof MigrationEventPayloads;

/**
 * Discriminated union of every event that can flow over the migration
 * subscription. Construct values via the `sendPhaseEvent` / `sendPhaseProgress`
 * helpers or directly with `eventSink.emit({ type: 'event', name, params })`
 * — TypeScript will enforce that `params` matches the chosen `name`.
 */
export type MigrationEvent = {
    [K in MigrationEventName]: { type: 'event'; name: K; params: MigrationEventPayloads[K] };
}[MigrationEventName];

/** Names of events whose payload is a single string `message`. */
export type MigrationProgressEventName = {
    [K in MigrationEventName]: MigrationEventPayloads[K] extends [message: string] ? K : never;
}[MigrationEventName];

// ─── Migration Events Router ────────────────────────────────────────────────

export const migrationEventsRouterDef = migrationRouter({
    /**
     * Subscription that streams migration events from the extension to the
     * webview. Yields { type, name, params } payloads from a TypedEventSink.
     */
    events: migrationProcedure.subscription(async function* ({ ctx }) {
        const sink: TypedEventSink<MigrationEvent> = ctx.eventSink;

        for await (const event of sink) {
            if (ctx.signal?.aborted) {
                return;
            }
            yield event;
        }
    }),
});
