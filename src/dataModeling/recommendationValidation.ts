/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'node:crypto';
import type * as vscode from 'vscode';
import { type WizardState } from '../webviews/cosmosdb/DataModeling/dataModel';
import { type ScenarioId } from '../webviews/cosmosdb/DataModeling/models';
import { getPartitionKeyPaths } from './deploymentModel';
import { buildRecommendationPrompt } from './recommendationPrompt';
import { type PartitionKeyRecommendation } from './recommendationSchema';
import { runRecommendationValidationChat, ValidationChatInterruptedError } from './recommendationValidationChat';

export interface ValidationScenario {
    id: ScenarioId;
    title: string;
    wizard: WizardState;
}

export interface KeyComparison {
    entity: string;
    expected?: string;
    actual?: string;
    status: 'match' | 'different' | 'missing' | 'unexpected' | 'duplicate' | 'invalid';
}

export interface ScenarioValidationResult {
    scenario: ValidationScenario;
    status: 'completed' | 'failed' | 'cancelled' | 'notRun';
    durationMs: number;
    comparisons: KeyComparison[];
    error?: string;
    failureKind?: 'reportedFailure' | 'runnerError' | 'invalidCoverage';
    recommendation?: PartitionKeyRecommendation;
    requestId?: string;
}

export interface RecommendationValidationReport {
    startedAt: string;
    updatedAt: string;
    finished: boolean;
    model: Pick<vscode.LanguageModelChat, 'id' | 'name' | 'vendor' | 'family' | 'version' | 'maxInputTokens'>;
    extensionVersion: string;
    results: ScenarioValidationResult[];
}

/** Compare ordered paths, ignoring formatting whitespace but never path order, nesting, or case. */
export function compareRecommendationKeys(
    expected: readonly { entity: string; partitionKey: string }[],
    actual: PartitionKeyRecommendation['containers'],
): KeyComparison[] {
    const comparisons: KeyComparison[] = expected.map((baseline) => {
        const matches = actual.filter((container) => container.entity === baseline.entity);
        if (matches.length !== 1) {
            return {
                entity: baseline.entity,
                expected: baseline.partitionKey,
                actual: matches.map((container) => container.partitionKey).join(' | ') || undefined,
                status: matches.length ? 'duplicate' : 'missing',
            };
        }
        const key = matches[0].partitionKey;
        const paths = getPartitionKeyPaths(key);
        const baselinePaths = getPartitionKeyPaths(baseline.partitionKey);
        const valid = paths.every((path) => path.startsWith('/') && path.length > 1);
        return {
            entity: baseline.entity,
            expected: baseline.partitionKey,
            actual: key,
            status: !valid
                ? 'invalid'
                : paths.length === baselinePaths.length && paths.every((path, index) => path === baselinePaths[index])
                  ? 'match'
                  : 'different',
        };
    });
    for (const container of actual.filter((entry) => !expected.some((baseline) => baseline.entity === entry.entity))) {
        comparisons.push({ entity: container.entity, actual: container.partitionKey, status: 'unexpected' });
    }
    return comparisons;
}

export function createValidationReport(
    scenarios: ValidationScenario[],
    model: vscode.LanguageModelChat,
    extensionVersion: string,
): RecommendationValidationReport {
    const now = new Date().toISOString();
    return {
        startedAt: now,
        updatedAt: now,
        finished: false,
        model: {
            id: model.id,
            name: model.name,
            vendor: model.vendor,
            family: model.family,
            version: model.version,
            maxInputTokens: model.maxInputTokens,
        },
        extensionVersion,
        results: scenarios.map((scenario) => ({
            scenario,
            status: 'notRun',
            durationMs: 0,
            comparisons: [],
        })),
    };
}

/** Sequential, fresh conversations; checkpoint errors propagate rather than allowing unsaved model calls. */
export async function runRecommendationValidation(
    report: RecommendationValidationReport,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    checkpoint: (report: RecommendationValidationReport) => Promise<void>,
    onScenario: (title: string, index: number, count: number) => void,
    runCase: typeof runRecommendationValidationChat = runRecommendationValidationChat,
): Promise<void> {
    await checkpoint(report);
    for (let index = 0; index < report.results.length; index++) {
        if (token.isCancellationRequested) break;
        const result = report.results[index];
        onScenario(result.scenario.title, index, report.results.length);
        const started = Date.now();
        let interrupted = false;
        try {
            const requestId = randomUUID();
            result.requestId = requestId;
            const prompt = await buildRecommendationPrompt(result.scenario.wizard, requestId, {
                disableDefaultHints: true,
                destination: 'validationReport',
            });
            const outcome = await runCase(model, prompt, requestId, token);
            if (token.isCancellationRequested) {
                result.status = 'cancelled';
                result.error = 'Cancelled by the user.';
            } else {
                if (outcome.error !== undefined) {
                    result.status = 'failed';
                    result.failureKind = 'reportedFailure';
                    result.error = outcome.error;
                } else {
                    result.recommendation = {
                        summary: outcome.summary,
                        containers: outcome.containers,
                    };
                    result.comparisons = compareRecommendationKeys(
                        result.scenario.wizard.dataModel.containers,
                        result.recommendation.containers,
                    );
                    const malformed = result.comparisons.some(
                        (entry) => entry.status !== 'match' && entry.status !== 'different',
                    );
                    result.status = malformed ? 'failed' : 'completed';
                    if (malformed) {
                        result.failureKind = 'invalidCoverage';
                        result.error =
                            'Recommendation contains missing, unexpected, duplicate, or invalid container keys.';
                    }
                }
            }
        } catch (error) {
            interrupted = error instanceof ValidationChatInterruptedError;
            result.status = token.isCancellationRequested ? 'cancelled' : 'failed';
            if (!token.isCancellationRequested) result.failureKind = 'runnerError';
            result.error = token.isCancellationRequested
                ? 'Cancelled by the user.'
                : error instanceof Error
                  ? error.message
                  : String(error);
        }
        result.durationMs = Date.now() - started;
        report.updatedAt = new Date().toISOString();
        await checkpoint(report);
        if (interrupted) break;
    }
    report.finished = true;
    report.updatedAt = new Date().toISOString();
    await checkpoint(report);
}

function cell(value: string | number | undefined): string {
    return String(value ?? '—')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\\/g, '\\\\')
        .replace(/([|`*_[\]])/g, '\\$1')
        .replace(/\r?\n/g, '<br>');
}

function comparisonReason(comparison: KeyComparison, result: ScenarioValidationResult): string {
    const reasons: Record<KeyComparison['status'], string> = {
        match: '',
        different: 'Ordered, case-sensitive partition-key paths differ from the built-in key.',
        missing: 'The model did not return this container.',
        unexpected: 'The model returned a container that is not in the scenario.',
        duplicate: 'The model returned multiple recommendations for this container.',
        invalid: 'The model key contains an empty path or a path without a leading slash.',
    };
    const reason = reasons[comparison.status];
    if (comparison.status !== 'different' && comparison.status !== 'invalid') return reason;
    const rationale = result.recommendation?.containers.find(
        (container) => container.entity === comparison.entity,
    )?.rationale;
    return rationale ? `${reason} Model rationale: ${rationale}` : `${reason} No model rationale was provided.`;
}

/** Local diagnostic report only; no model inputs, responses, paths, or names are emitted to telemetry. */
export function formatRecommendationValidationReport(report: RecommendationValidationReport): string {
    const comparisons = report.results.flatMap((result) => result.comparisons);
    const lines = [
        '# Data Modeler recommendation validation',
        '',
        '## Summary',
        '',
        `- Run state: ${report.finished ? 'Finished' : 'In progress (checkpoint)'}`,
        `- Requested Chat model: ${cell(report.model.name)} (${cell(report.model.id)}, ${cell(report.model.version)})`,
        `- Completed scenarios: ${report.results.filter((entry) => entry.status === 'completed').length} / ${report.results.length}`,
        `- Failed scenarios: ${report.results.filter((entry) => entry.status === 'failed').length}`,
        `- Reported failures: ${report.results.filter((entry) => entry.failureKind === 'reportedFailure').length}`,
        `- Runner errors: ${report.results.filter((entry) => entry.failureKind === 'runnerError').length}`,
        `- Invalid container coverage: ${report.results.filter((entry) => entry.failureKind === 'invalidCoverage').length}`,
        `- Cancelled / not run: ${report.results.filter((entry) => entry.status === 'cancelled' || entry.status === 'notRun').length}`,
        `- Container matches: ${comparisons.filter((entry) => entry.status === 'match').length}`,
        `- Different keys: ${comparisons.filter((entry) => entry.status === 'different').length}`,
        '',
        '| Scenario | Status | Container | Built-in key | Model key | Comparison | Reason | Duration (ms) |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ];
    for (const result of report.results) {
        if (!result.comparisons.length) {
            const status = result.failureKind ?? result.status;
            for (const container of result.scenario.wizard.dataModel.containers) {
                lines.push(
                    `| ${cell(result.scenario.title)} | ${status} | ${cell(container.entity)} | ${cell(container.partitionKey)} | — | Not compared | ${cell(result.error ?? (result.status === 'notRun' ? 'Scenario has not run.' : result.status === 'cancelled' ? 'Validation was cancelled.' : 'No container comparisons were produced.'))} | ${result.durationMs} |`,
                );
            }
        }
        for (const comparison of result.comparisons) {
            lines.push(
                `| ${cell(result.scenario.title)} | ${result.status} | ${cell(comparison.entity)} | ${cell(comparison.expected)} | ${cell(comparison.actual)} | ${comparison.status === 'different' ? '**DIFFERENT**' : comparison.status} | ${cell(comparisonReason(comparison, result))} | ${result.durationMs} |`,
            );
        }
    }
    return lines.join('\n') + '\n';
}
