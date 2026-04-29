/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type LanguageModelChat } from 'vscode';
import { type ProjectJson } from '../../../services/MigrationProjectService';

export type MigrationPhaseKey = 'discovery' | 'assessment' | 'schemaConversion' | 'provisioning';

/**
 * Stamps shared migration telemetry context on an `IActionContext`.
 * Call at the top of every `callWithTelemetryAndErrorHandling` in migration code.
 */
export function setMigrationTelemetryContext(
    context: IActionContext,
    project: ProjectJson | undefined,
    phase?: MigrationPhaseKey,
): void {
    if (!project) return;

    if (project.sessionId) {
        context.telemetry.properties.sessionId = project.sessionId;
    }

    if (phase) {
        context.telemetry.properties.phase = phase;
        const runIndex = project.runCounts?.[phase];
        if (runIndex !== undefined) {
            context.telemetry.measurements.runIndex = runIndex;
        }

        // Check whether this phase has custom instructions set
        const hasCustomInstructions = getHasCustomInstructions(project, phase);
        context.telemetry.properties.hasCustomInstructions = String(hasCustomInstructions);
    }

    if (project.migrationMode) {
        context.telemetry.properties.migrationMode = project.migrationMode;
    }

    const dbType = project.phases.discovery.applicationAnalysis?.databaseType;
    if (dbType) {
        context.telemetry.properties.sourceDbType = dbType;
    }

    // Mask only tenantId — other Azure org info is safe to send as plain text
    const tenantId = project.phases.targetEnvironment?.tenantId;
    if (tenantId) {
        context.valuesToMask.push(tenantId);
    }

    // Stamp issueProperties so Report Issue always includes basic migration context
    if (project.sessionId) {
        context.errorHandling.issueProperties.sessionId = project.sessionId;
    }
    if (phase) {
        context.errorHandling.issueProperties.phase = phase;
    }
    if (project.migrationMode) {
        context.errorHandling.issueProperties.migrationMode = project.migrationMode;
    }
    if (dbType) {
        context.errorHandling.issueProperties.sourceDbType = dbType;
    }
}

/**
 * Stamps AI model information on telemetry context.
 */
export function setAiTelemetryContext(context: IActionContext, model: LanguageModelChat): void {
    context.telemetry.properties.modelId = model.id;
    context.telemetry.properties.modelFamily = model.family;
    context.telemetry.properties.modelVendor = model.vendor;
}

/**
 * Extracts the account name from a Cosmos DB endpoint URL.
 * The account name is always the first subdomain.
 * E.g., `https://myaccount.documents.azure.com:443/` → `myaccount`
 */
export function extractAccountNameFromEndpoint(endpoint: string): string | undefined {
    try {
        const url = new URL(endpoint);
        const hostname = url.hostname;
        const firstDot = hostname.indexOf('.');
        if (firstDot > 0) {
            return hostname.substring(0, firstDot);
        }
        return hostname || undefined;
    } catch {
        return undefined;
    }
}

/**
 * Increments the run count for a phase and returns the new value.
 * Mutates `project.runCounts` in place — caller must persist.
 */
export function incrementRunCount(project: ProjectJson, phase: MigrationPhaseKey): number {
    if (!project.runCounts) {
        project.runCounts = {};
    }
    const current = project.runCounts[phase] ?? 0;
    project.runCounts[phase] = current + 1;
    return current + 1;
}

function getHasCustomInstructions(project: ProjectJson, phase: MigrationPhaseKey): boolean {
    switch (phase) {
        case 'discovery':
            return !!project.phases.discovery.discoveryInstructions;
        case 'assessment':
            return !!project.phases.assessment?.assessmentInstructions;
        case 'schemaConversion':
            return !!project.phases.schemaConversion?.schemaConversionInstructions;
        case 'provisioning':
            return false; // No custom instructions field for provisioning
    }
}

/**
 * Enriches the telemetry context with error classification and report-issue metadata.
 * Call in catch blocks before rethrowing. No-op for cancellation errors (framework handles those).
 */
export function enrichErrorContext(context: IActionContext, error: unknown): void {
    // Cancellation is auto-handled by the framework — no enrichment needed
    if (error instanceof vscode.CancellationError) {
        return;
    }

    // Make this error reportable through the unified "Report Issue" command
    context.errorHandling.forceIncludeInReportIssueCommand = true;

    // Classify AI errors vs infrastructure errors
    if (error instanceof vscode.LanguageModelError) {
        context.telemetry.properties.errorCategory = 'ai';
        context.telemetry.properties.aiErrorCode = error.code;
        context.errorHandling.issueProperties.errorCategory = 'ai';
        context.errorHandling.issueProperties.aiErrorCode = error.code;
        if (error.code === 'Unknown' && error.cause) {
            // Only in telemetry — not in issueProperties to avoid leaking model internals
            const cause = error.cause;
            context.telemetry.properties.aiErrorCause = cause instanceof Error ? cause.message : JSON.stringify(cause);
        }
    } else {
        context.telemetry.properties.errorCategory = 'infrastructure';
        context.errorHandling.issueProperties.errorCategory = 'infrastructure';
    }

    // Copy model info from telemetry.properties into issueProperties for the GitHub issue body
    const modelId = context.telemetry.properties.modelId;
    if (modelId && typeof modelId === 'string') {
        context.errorHandling.issueProperties.modelId = modelId;
    }
    const modelFamily = context.telemetry.properties.modelFamily;
    if (modelFamily && typeof modelFamily === 'string') {
        context.errorHandling.issueProperties.modelFamily = modelFamily;
    }
}
