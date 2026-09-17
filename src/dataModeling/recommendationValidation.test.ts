/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { createMockLanguageModel } from '../utils/languageModelMockUtils';
import { applyScenario, createInitialState } from '../webviews/cosmosdb/DataModeling/dataModel';
import { getScenarioList } from '../webviews/cosmosdb/DataModeling/scenarios';
import {
    compareRecommendationKeys,
    createValidationReport,
    formatRecommendationValidationReport,
    runRecommendationValidation,
    type ValidationScenario,
} from './recommendationValidation';
import { type runRecommendationValidationChat, ValidationChatInterruptedError } from './recommendationValidationChat';

vi.mock('../chat/reportPartitionKeyRecommendationTool', () => ({
    REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME: 'cosmosdb_reportPartitionKeyRecommendation',
}));

const model = createMockLanguageModel({
    id: 'test-model-id',
    name: 'Test model',
    family: 'test-family',
    vendor: 'copilot',
    version: 'test-version',
    resolveResponse: () => '',
});
const scenarios: ValidationScenario[] = getScenarioList()
    .filter(({ id }) => id !== 'other')
    .map(({ id, title }) => ({ id, title, wizard: applyScenario(createInitialState(), id) }));

describe('recommendation comparison', () => {
    const expected = [{ entity: 'Orders', partitionKey: '/customerId, /orderId' }];
    it.each([
        { key: ' /customerId ,  /orderId ', status: 'match' },
        { key: '/orderId, /customerId', status: 'different' },
        { key: '/customerId/orderId', status: 'different' },
        { key: '/CustomerId, /orderId', status: 'different' },
        { key: '/customerId', status: 'different' },
        { key: '', status: 'invalid' },
        { key: 'customerId', status: 'invalid' },
    ] as const)('compares $key as $status', ({ key, status }) => {
        expect(compareRecommendationKeys(expected, [{ entity: 'Orders', partitionKey: key, rationale: '' }])).toEqual([
            { entity: 'Orders', expected: expected[0].partitionKey, actual: key, status },
        ]);
    });

    it('flags missing, duplicate, and unexpected entities rather than positional comparisons', () => {
        expect(compareRecommendationKeys(expected, [])).toMatchObject([{ status: 'missing' }]);
        const container = { entity: 'Orders', partitionKey: '/id', rationale: '' };
        expect(compareRecommendationKeys(expected, [container, container])).toMatchObject([{ status: 'duplicate' }]);
        expect(compareRecommendationKeys(expected, [{ ...container, entity: 'Other' }])).toMatchObject([
            { status: 'missing' },
            { entity: 'Other', status: 'unexpected' },
        ]);
    });
});

describe('scenario validation batch', () => {
    function matchingRunner() {
        let index = 0;
        return vi
            .fn<typeof runRecommendationValidationChat>()
            .mockImplementation(async (_model, _prompt, requestId) => {
                const scenario = scenarios[index++];
                return {
                    wizardTabId: requestId,
                    summary: 'Based on the workload.',
                    containers: scenario.wizard.dataModel.containers.map(({ entity, partitionKey }) => ({
                        entity,
                        partitionKey,
                        rationale: 'Workload alignment.',
                    })),
                };
            });
    }

    it('runs all 15 scenarios sequentially with unchanged inputs and disabled hint context', async () => {
        const before = structuredClone(scenarios);
        const runner = matchingRunner();
        const report = createValidationReport(scenarios, model, '0.37.2');
        const checkpoint = vi.fn().mockResolvedValue(undefined);
        const progress = vi.fn();
        const token = new vscode.CancellationTokenSource();
        await runRecommendationValidation(report, model, token.token, checkpoint, progress, runner);
        expect(runner).toHaveBeenCalledTimes(15);
        expect(report.finished).toBe(true);
        expect(checkpoint).toHaveBeenCalledTimes(17);
        expect(report.results.every((result) => result.status === 'completed')).toBe(true);
        expect(report.results.flatMap((result) => result.comparisons)).toHaveLength(24);
        expect(report.results.flatMap((result) => result.comparisons).every((entry) => entry.status === 'match')).toBe(
            true,
        );
        expect(new Set(runner.mock.calls.map((call) => call[2])).size).toBe(15);
        for (const [index, call] of runner.mock.calls.entries()) {
            expect(call[0]).toBe(model);
            expect(call[1]).toContain('"defaultsUnchanged":false,"hint":null,"containerHints":[]');
            expect(call[1]).toContain(JSON.stringify(scenarios[index].wizard.dataModel));
            expect(call[1]).toContain('cosmosdb-data-model-recommendation');
            expect(call[1]).toContain('This request targets the validation report, not a wizard UI');
        }
        expect(scenarios).toEqual(before);
        expect(report.model).toMatchObject({ id: 'test-model-id', family: 'test-family', version: 'test-version' });
        token.dispose();
    });

    it('records refusals and infrastructure errors then continues with other scenarios', async () => {
        const runner = matchingRunner()
            .mockResolvedValueOnce({ wizardTabId: 'id', error: 'Missing cardinality evidence.' })
            .mockRejectedValueOnce(new Error('Model unavailable'));
        const report = createValidationReport(scenarios.slice(0, 3), model, 'test');
        const token = new vscode.CancellationTokenSource();
        await runRecommendationValidation(
            report,
            model,
            token.token,
            async () => {},
            () => {},
            runner,
        );
        expect(report.results[0]).toMatchObject({
            status: 'failed',
            failureKind: 'reportedFailure',
            error: 'Missing cardinality evidence.',
        });
        expect(report.results[1]).toMatchObject({
            status: 'failed',
            failureKind: 'runnerError',
            error: 'Model unavailable',
        });
        const markdown = formatRecommendationValidationReport(report);
        expect(markdown).toContain('- Reported failures: 1');
        expect(markdown).toContain('- Runner errors: 1');
        expect(runner).toHaveBeenCalledTimes(3);
        token.dispose();
    });

    it('records key differences without marking them as invalid recommendations', async () => {
        const scenario = scenarios.find((entry) => entry.id === 'profiles')!;
        const runner = vi
            .fn<typeof runRecommendationValidationChat>()
            .mockImplementation(async (_model, _prompt, requestId) => ({
                wizardTabId: requestId,
                summary: 'Use another key.',
                containers: [
                    {
                        entity: 'UserProfile',
                        partitionKey: '/id',
                        rationale: 'Point reads.',
                    },
                ],
            }));
        const report = createValidationReport([scenario], model, 'test');
        const token = new vscode.CancellationTokenSource();
        await runRecommendationValidation(
            report,
            model,
            token.token,
            async () => {},
            () => {},
            runner,
        );
        expect(report.results[0]).toMatchObject({
            status: 'completed',
            comparisons: [{ entity: 'UserProfile', expected: '/userId', actual: '/id', status: 'different' }],
        });
        token.dispose();
    });

    it('fails incomplete container coverage rather than counting it as a match', async () => {
        const runner = vi.fn<typeof runRecommendationValidationChat>().mockResolvedValue({
            wizardTabId: 'id',
            summary: 'Partial result',
            containers: [
                {
                    entity: 'MissingContainer',
                    partitionKey: '/id',
                    rationale: '',
                },
            ],
        });
        const report = createValidationReport(scenarios.slice(0, 1), model, 'test');
        const token = new vscode.CancellationTokenSource();
        await runRecommendationValidation(
            report,
            model,
            token.token,
            async () => {},
            () => {},
            runner,
        );
        expect(report.results[0].status).toBe('failed');
        expect(report.results[0].failureKind).toBe('invalidCoverage');
        expect(report.results[0].comparisons.some((entry) => entry.status === 'unexpected')).toBe(true);
        token.dispose();
    });

    it('persists cancellation and leaves remaining scenarios explicitly not run', async () => {
        const token = new vscode.CancellationTokenSource();
        const runner = vi.fn<typeof runRecommendationValidationChat>().mockImplementation(async () => {
            token.cancel();
            throw new Error('Cancelled');
        });
        const report = createValidationReport(scenarios, model, 'test');
        const checkpoint = vi.fn().mockResolvedValue(undefined);
        await runRecommendationValidation(report, model, token.token, checkpoint, () => {}, runner);
        expect(runner).toHaveBeenCalledOnce();
        expect(report.results[0].status).toBe('cancelled');
        expect(report.results.slice(1).every((result) => result.status === 'notRun')).toBe(true);
        expect(report.finished).toBe(true);
        expect(checkpoint).toHaveBeenCalledTimes(3);
        token.dispose();
    });

    it('writes a not-run report without model calls when cancelled before starting', async () => {
        const token = new vscode.CancellationTokenSource();
        token.cancel();
        const runner = matchingRunner();
        const report = createValidationReport(scenarios, model, 'test');
        const checkpoint = vi.fn().mockResolvedValue(undefined);
        await runRecommendationValidation(report, model, token.token, checkpoint, () => {}, runner);
        expect(runner).not.toHaveBeenCalled();
        expect(report.results.every((result) => result.status === 'notRun')).toBe(true);
        expect(report.finished).toBe(true);
        expect(checkpoint).toHaveBeenCalledTimes(2);
        token.dispose();
    });

    it('does not start model calls if the initial report cannot be written', async () => {
        const runner = matchingRunner();
        const report = createValidationReport(scenarios, model, 'test');
        const token = new vscode.CancellationTokenSource();
        await expect(
            runRecommendationValidation(
                report,
                model,
                token.token,
                async () => {
                    throw new Error('Disk full');
                },
                () => {},
                runner,
            ),
        ).rejects.toThrow('Disk full');
        expect(runner).not.toHaveBeenCalled();
        token.dispose();
    });

    it('stops further calls when a checkpoint fails', async () => {
        const runner = matchingRunner();
        const checkpoint = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('Disk full'));
        const token = new vscode.CancellationTokenSource();
        await expect(
            runRecommendationValidation(
                createValidationReport(scenarios, model, 'test'),
                model,
                token.token,
                checkpoint,
                () => {},
                runner,
            ),
        ).rejects.toThrow('Disk full');
        expect(runner).toHaveBeenCalledOnce();
        token.dispose();
    });
});

describe('Markdown validation report', () => {
    it.each([
        ['missing', 'The model did not return this container.'],
        ['unexpected', 'The model returned a container that is not in the scenario.'],
        ['duplicate', 'The model returned multiple recommendations for this container.'],
        ['invalid', 'The model key contains an empty path or a path without a leading slash.'],
        ['different', 'No model rationale was provided.'],
    ] as const)('explains %s comparisons in the summary', (status, reason) => {
        const report = createValidationReport(scenarios.slice(0, 1), model, 'test');
        report.results[0].comparisons = [{ entity: 'ChatSession', status }];
        expect(formatRecommendationValidationReport(report)).toContain(reason);
    });

    it('includes only the summary with mismatch reasons and partial-run status', () => {
        const report = createValidationReport(scenarios, model, '0.37.2');
        const result = report.results[0];
        result.status = 'completed';
        result.comparisons = [{ entity: 'ChatSession', expected: '/sessionId', actual: '/id', status: 'different' }];
        result.recommendation = {
            summary: 'Raw recommendation summary',
            containers: [{ entity: 'ChatSession', partitionKey: '/id', rationale: 'Point reads | <evidence>.' }],
        };
        const markdown = formatRecommendationValidationReport(report);
        expect(markdown).toContain('test-model-id');
        expect(markdown).toContain('test-version');
        expect(markdown).toContain('In progress (checkpoint)');
        expect(markdown).toContain('**DIFFERENT**');
        expect(markdown).toContain('/sessionId');
        expect(markdown).toContain('- Different keys: 1');
        expect(markdown).toContain('- Cancelled / not run: 14');
        expect(markdown).toContain('Ordered, case-sensitive partition-key paths differ from the built-in key.');
        expect(markdown).toContain('Model rationale: Point reads \\| &lt;evidence&gt;.');
        expect(markdown).not.toContain('## Scenario details');
        expect(markdown).not.toContain('#### Input workload');
        expect(markdown).not.toContain('Raw recommendation summary');
        expect(markdown).not.toContain('```');
    });

    it('escapes generated table content and failure text', () => {
        const report = createValidationReport(scenarios.slice(0, 1), model, 'test');
        report.results[0].status = 'failed';
        report.results[0].error = '<img src=x> | [link](https://example.com)\nnext';
        const markdown = formatRecommendationValidationReport(report);
        expect(markdown).toContain('&lt;img src=x&gt; \\| \\[link\\]');
        expect(markdown).not.toContain('<img src=x>');
    });

    it('includes the full refusal reason in the summary table with baseline keys', () => {
        const report = createValidationReport(scenarios.slice(0, 1), model, 'test');
        const error = 'Missing local guidance.\nProvide maximum retained bytes per key before retrying.';
        report.results[0].status = 'failed';
        report.results[0].failureKind = 'reportedFailure';
        report.results[0].error = error;
        const markdown = formatRecommendationValidationReport(report);
        expect(markdown).toContain('| reportedFailure | ChatSession | /sessionId |');
        expect(markdown).toContain('| Not compared | Missing local guidance.');
        expect(markdown).toContain(
            'Missing local guidance.<br>Provide maximum retained bytes per key before retrying.',
        );
        expect(markdown).toContain('- Container matches: 0');
        expect(markdown).toContain('- Runner errors: 0');
    });
});

it('stops the batch after a Chat timeout so it cannot replace a still-running session', async () => {
    const report = createValidationReport(scenarios, model, 'test');
    const token = new vscode.CancellationTokenSource();
    const runner = vi
        .fn<typeof runRecommendationValidationChat>()
        .mockRejectedValue(new ValidationChatInterruptedError('Timed out'));
    await runRecommendationValidation(
        report,
        model,
        token.token,
        async () => {},
        () => {},
        runner,
    );
    expect(runner).toHaveBeenCalledOnce();
    expect(report.results[0]).toMatchObject({ status: 'failed', error: 'Timed out' });
    expect(report.results.slice(1).every((entry) => entry.status === 'notRun')).toBe(true);
    token.dispose();
});
