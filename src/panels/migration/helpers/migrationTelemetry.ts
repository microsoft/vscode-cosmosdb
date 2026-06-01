/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type LanguageModelChat } from 'vscode';
import { type ProjectJson } from '../../../services/MigrationProjectService';
import { type ExtractionStats } from '../../../utils/ddlExtractor';
import { type FileEncoding } from '../../../utils/decodeFileBytes';

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

// ─── DDL extractor telemetry ────────────────────────────────────────────────

/**
 * Adds per-call extractor stats to the supplied `IActionContext` (used by
 * `callWithTelemetryAndErrorHandling` for the `cosmosDB.migration.ddlExtractor.extract`
 * event) and accumulates phase-level rollups on the optional phase context for
 * dashboards/alerts that prefer one record per phase.
 *
 * No file contents, paths, or names are emitted — only structural counts.
 */
export function reportDdlExtractorStats(
    callContext: IActionContext,
    stats: ExtractionStats,
    encoding: FileEncoding,
    phaseContext?: IActionContext,
): void {
    callContext.telemetry.properties.encoding = encoding;

    const m = callContext.telemetry.measurements;
    m.inputChars = stats.inputChars;
    m.outputChars = stats.outputChars;
    m.reductionRatio = round(stats.reductionRatio, 4);
    m.durationMs = stats.durationMs;
    m.warningsCount = stats.warnings.length;

    m.createTable = stats.statementCounts.createTable;
    m.alterTable = stats.statementCounts.alterTable;
    m.createIndex = stats.statementCounts.createIndex;
    m.createFulltextIndex = stats.statementCounts.createFulltextIndex;
    m.createView = stats.statementCounts.createView;
    m.createSequence = stats.statementCounts.createSequence;
    m.createType = stats.statementCounts.createType;
    m.createDomain = stats.statementCounts.createDomain;
    m.createSchema = stats.statementCounts.createSchema;
    m.otherStatements = stats.statementCounts.other;

    m.dropAlterCheckReenable = stats.drops.alterTableCheckReenable;
    m.dropAlterCheckConstraint = stats.drops.alterTableCheckConstraint;

    m.stripWith = stats.strips.withOptionBlocks;
    m.stripCheck = stats.strips.inlineCheckConstraints;
    m.stripOnPrimary = stats.strips.onPrimary;
    m.stripTextImageOn = stats.strips.textImageOn;
    m.stripFileStreamOn = stats.strips.fileStreamOn;
    m.stripCollate = stats.strips.collate;
    m.stripRowGuidCol = stats.strips.rowGuidCol;
    m.stripNotForReplication = stats.strips.notForReplication;

    m.viewsSummarized = stats.views.summarized;
    m.viewsRefsTotal = stats.views.referencedTablesTotal;

    if (phaseContext) {
        const pm = phaseContext.telemetry.measurements;
        pm.ddlFilesProcessed = (pm.ddlFilesProcessed ?? 0) + 1;
        pm.ddlInputCharsTotal = (pm.ddlInputCharsTotal ?? 0) + stats.inputChars;
        pm.ddlOutputCharsTotal = (pm.ddlOutputCharsTotal ?? 0) + stats.outputChars;
        pm.ddlDurationMsTotal = (pm.ddlDurationMsTotal ?? 0) + stats.durationMs;
        pm.ddlWarningsTotal = (pm.ddlWarningsTotal ?? 0) + stats.warnings.length;
        pm.ddlStatementsTotal =
            (pm.ddlStatementsTotal ?? 0) +
            stats.statementCounts.createTable +
            stats.statementCounts.alterTable +
            stats.statementCounts.createIndex +
            stats.statementCounts.createFulltextIndex +
            stats.statementCounts.createView +
            stats.statementCounts.createSequence +
            stats.statementCounts.createType +
            stats.statementCounts.createDomain +
            stats.statementCounts.createSchema +
            stats.statementCounts.other;

        // Recompute average reduction ratio across files seen so far in this phase
        if (pm.ddlInputCharsTotal > 0) {
            pm.ddlReductionRatioAvg = round(1 - pm.ddlOutputCharsTotal / pm.ddlInputCharsTotal, 4);
        }
    }
}

/** Returns a one-line, human-readable summary of an extraction for the output channel. */
export function formatDdlExtractorSummary(
    fileBaseName: string,
    stats: ExtractionStats,
    encoding: FileEncoding,
): string {
    const c = stats.statementCounts;
    const pct = (stats.reductionRatio * 100).toFixed(1);
    const parts: string[] = [];
    if (c.createTable) parts.push(`${c.createTable} table${c.createTable === 1 ? '' : 's'}`);
    if (c.alterTable) parts.push(`${c.alterTable} alter${c.alterTable === 1 ? '' : 's'}`);
    if (c.createIndex || c.createFulltextIndex) {
        parts.push(`${c.createIndex + c.createFulltextIndex} indexes`);
    }
    if (stats.views.summarized) parts.push(`${stats.views.summarized} views summarized`);
    const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
    return (
        `Schema "${fileBaseName}": ${formatBytes(stats.inputChars)} ${encoding} → ` +
        `${formatBytes(stats.outputChars)} (-${pct}%) in ${stats.durationMs} ms${detail}`
    );
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function round(n: number, digits: number): number {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
}
