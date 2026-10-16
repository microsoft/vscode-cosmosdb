/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TypedEventSink } from '@microsoft/vscode-ext-webview';
import { type ModelInfo } from '../../../utils/modelUtils';
import { type MigrationRunActivity } from '../../../webviews/cosmosdb/Migration/state/deriveMigrationPhaseStates';
import {
    type MigrationPhaseCompletionMap,
    type MigrationProjectView,
} from '../../migration/helpers/migrationStateSync';
import { migrationProcedure, migrationRouter } from '../trpc';

export interface AssessmentResultPayload {
    domainFiles: {
        name: string;
        tables: string[];
        filePath: string;
        isMapped: boolean;
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
    project: MigrationProjectView;
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
    phaseCompletion: MigrationPhaseCompletionMap;
    runActivity: MigrationRunActivity | null;
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

export type ConnectionTestResultPayload =
    | { success: true }
    | { success: false; error: string; documentationUrl: string | undefined };

// ─── Event Payload Map ──────────────────────────────────────────────────────

export type MigrationEventPayloads = {
    runActivityChanged: [activity: MigrationRunActivity | null];

    // Target environment
    accountSelected: [data: AccountSelectedPayload];
    resourceGroupSelected: [data: ResourceGroupSelectedPayload];
    locationsList: [locations: AzureLocation[]];
    connectionTestStarted: [];
    connectionTestProgress: [message: string];
    connectionTestResult: [result: ConnectionTestResultPayload];

    // Project / file state
    projectLoaded: [data: ProjectLoadedPayload];

    // Git
    gitStatus: [hasGit: boolean];
    gitignoreStatus: [isInGitignore: boolean];

    // AI / models
    availableModels: [models: ModelInfo[], savedModelId: string | null];
    aiFeaturesEnabledChanged: [available: boolean];
};

export type MigrationEventName = keyof MigrationEventPayloads;

/**
 * Discriminated union of every event that can flow over the migration
 * subscription. Construct values via the `emitMigrationEvent` / `sendPhaseProgress`
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
