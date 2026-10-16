/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
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
        // Preserve the recorded run count when inspecting historical projects.
        context.telemetry.measurements.runIndex = project.runCounts?.[phase] ?? 0;

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

    // OII identifiers are emitted as-is under their predefined property names
    // (`subscriptionId`, `tenantId`, `accountName`), but they should still be
    // redacted from any error messages emitted alongside the event.
    const targetEnv = project.phases.targetEnvironment;
    if (targetEnv?.tenantId) {
        context.valuesToMask.push(targetEnv.tenantId);
    }
    if (targetEnv?.subscriptionId) {
        context.valuesToMask.push(targetEnv.subscriptionId);
    }
    const targetAccountName =
        targetEnv?.accountName ||
        (targetEnv?.endpoint ? extractAccountNameFromEndpoint(targetEnv.endpoint) : undefined);
    if (targetAccountName) {
        context.valuesToMask.push(targetAccountName);
    }
    if (targetEnv?.resourceGroup) {
        context.valuesToMask.push(targetEnv.resourceGroup);
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
