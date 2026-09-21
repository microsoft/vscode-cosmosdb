/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { captureRegisteredTool, serializeToolResult } from '../chat/queryEditorToolTestUtils';
import { registerReportPartitionKeyRecommendationTool } from '../chat/reportPartitionKeyRecommendationTool';
import { createMockLanguageModel } from '../utils/languageModelMockUtils';
import { applyScenario, createInitialState } from '../webviews/cosmosdb/DataModeling/dataModel';
import { getScenarioList } from '../webviews/cosmosdb/DataModeling/scenarios';
import {
    createValidationReport,
    formatRecommendationValidationReport,
    runRecommendationValidation,
} from './recommendationValidation';
import { runRecommendationValidationChat } from './recommendationValidationChat';
import {
    deliverRecommendationValidationResult,
    registerRecommendationValidationRequest,
} from './recommendationValidationRequests';

vi.mock('../extensionVariables', () => ({
    ext: { outputChannel: { info: vi.fn(), warn: vi.fn() } },
}));
vi.mock('../panels/DataModelingWizardTab', () => ({
    DataModelingWizardTab: { findById: vi.fn() },
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: async (_name: string, callback: (context: unknown) => unknown) =>
        callback({ telemetry: { properties: {}, measurements: {} }, errorHandling: {}, valuesToMask: [] }),
}));

const model = { id: 'claude-test', vendor: 'copilot', family: 'claude', version: '1' };
function outcome(id: string) {
    return {
        wizardTabId: id,
        summary: 'Use the workload key.',
        containers: [{ entity: 'Orders', partitionKey: '/customerId', rationale: 'Read alignment.' }],
    };
}
afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});
beforeEach(() => vi.clearAllMocks());

describe('Copilot Chat validation path', () => {
    it('runs the complete batch through Chat commands and the real report tool, not direct model requests', async () => {
        const selectedModel = createMockLanguageModel({
            ...model,
            name: 'Chosen Chat model',
            resolveResponse: () => {
                throw new Error('Must not call sendRequest');
            },
        });
        const sendRequest = vi.spyOn(selectedModel, 'sendRequest');
        const scenarios = getScenarioList()
            .filter(({ id }) => id !== 'other')
            .map(({ id, title }) => ({
                id,
                title,
                wizard: applyScenario(createInitialState(), id),
            }));
        const report = createValidationReport(scenarios, selectedModel, 'test');
        const tool = captureRegisteredTool(registerReportPartitionKeyRecommendationTool);
        const token = new vscode.CancellationTokenSource();
        let scenarioIndex = 0;
        vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (command, ...args: unknown[]) => {
            if (command === 'workbench.action.chat.open') {
                const options = args[0] as { query: string };
                const requestId = /wizardTabId "([^"]+)"/.exec(options.query)?.[1];
                if (!requestId) throw new Error('Request ID missing from shared prompt.');
                const scenario = scenarios[scenarioIndex++];
                await tool.invoke(
                    {
                        input: {
                            wizardTabId: requestId,
                            summary: 'Completed Chat analysis.',
                            containers: scenario.wizard.dataModel.containers.map(({ entity, partitionKey }) => ({
                                entity,
                                partitionKey,
                                rationale: 'Workload analysis.',
                            })),
                        },
                    },
                    token.token,
                );
            }
            return undefined;
        });
        const checkpoints: string[] = [];
        await runRecommendationValidation(
            report,
            selectedModel,
            token.token,
            async (current) => {
                checkpoints.push(formatRecommendationValidationReport(current));
            },
            () => {},
        );
        expect(sendRequest).not.toHaveBeenCalled();
        expect(scenarioIndex).toBe(15);
        expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(30);
        expect(report.results.every((entry) => entry.status === 'completed')).toBe(true);
        expect(report.results.flatMap((entry) => entry.comparisons)).toHaveLength(24);
        expect(checkpoints.at(-1)).toContain('- Container matches: 24');
        expect(checkpoints.at(-1)).toContain('claude-test');
        token.dispose();
    });

    it('opens a fresh Chat with the selected model and accepts the real report-tool callback', async () => {
        const id = randomUUID();
        const token = new vscode.CancellationTokenSource();
        const tool = captureRegisteredTool(registerReportPartitionKeyRecommendationTool);
        const commands: string[] = [];
        let toolResponse = '';
        vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (command) => {
            commands.push(command);
            if (command === 'workbench.action.chat.open') {
                const response = await tool.invoke({ input: outcome(id) }, token.token);
                toolResponse = serializeToolResult(response);
            }
            return undefined;
        });
        expect(await runRecommendationValidationChat(model, 'same wizard prompt', id, token.token)).toEqual(
            outcome(id),
        );
        expect(commands).toEqual(['workbench.action.chat.newChat', 'workbench.action.chat.open']);
        expect(toolResponse).toContain('validation request has been handled');
        expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith('workbench.action.chat.open', {
            query: 'same wizard prompt',
            mode: 'agent',
            modelSelector: model,
            blockOnResponse: true,
        });
        token.dispose();
    });

    it('records real report-tool failures and rejects malformed success as a failure', async () => {
        const tool = captureRegisteredTool(registerReportPartitionKeyRecommendationTool);
        const token = new vscode.CancellationTokenSource();
        const id = randomUUID();
        vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (command) => {
            if (command === 'workbench.action.chat.open') {
                await tool.invoke({ input: { wizardTabId: id, error: 'Cannot load required guidance.' } }, token.token);
            }
            return undefined;
        });
        expect(await runRecommendationValidationChat(model, 'prompt', id, token.token)).toEqual({
            wizardTabId: id,
            error: 'Cannot load required guidance.',
        });
        const invalidId = randomUUID();
        vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command) => {
            if (command === 'workbench.action.chat.open') {
                await tool.invoke({ input: { wizardTabId: invalidId, summary: '', containers: [] } }, token.token);
            }
            return undefined;
        });
        expect(await runRecommendationValidationChat(model, 'prompt', invalidId, token.token)).toMatchObject({
            wizardTabId: invalidId,
            error: 'The recommendation was not in the expected shape and could not be shown.',
        });
        token.dispose();
    });

    it('waits for user approvals without approving or invoking tools itself', async () => {
        const id = randomUUID();
        const token = new vscode.CancellationTokenSource();
        let opened!: () => void;
        const ready = new Promise<void>((resolve) => {
            opened = resolve;
        });
        vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (command) => {
            if (command === 'workbench.action.chat.open') {
                opened();
                return { type: 'confirmation' };
            }
            return undefined;
        });
        let finished = false;
        const run = runRecommendationValidationChat(model, 'prompt', id, token.token).then((result) => {
            finished = true;
            return result;
        });
        await ready;
        expect(finished).toBe(false);
        deliverRecommendationValidationResult(outcome(id));
        expect(await run).toEqual(outcome(id));
        expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(2);
        token.dispose();
    });

    it('fails rather than fabricating a report when Chat finishes without the report tool', async () => {
        vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
        const token = new vscode.CancellationTokenSource();
        await expect(runRecommendationValidationChat(model, 'prompt', randomUUID(), token.token)).rejects.toThrow(
            'without invoking the recommendation report tool',
        );
        token.dispose();
    });

    it('surfaces model selection errors from Chat rather than falling back to a different model', async () => {
        vi.spyOn(vscode.commands, 'executeCommand')
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('No language models found matching selector'));
        const token = new vscode.CancellationTokenSource();
        await expect(runRecommendationValidationChat(model, 'prompt', randomUUID(), token.token)).rejects.toThrow(
            'No language models found',
        );
        token.dispose();
    });

    it('times out stalled Chat requests and ignores late callbacks', async () => {
        vi.useFakeTimers();
        const id = randomUUID();
        const token = new vscode.CancellationTokenSource();
        vi.spyOn(vscode.commands, 'executeCommand')
            .mockResolvedValueOnce(undefined)
            .mockImplementationOnce(() => new Promise(() => {}));
        const run = runRecommendationValidationChat(model, 'prompt', id, token.token, 100);
        await Promise.all([expect(run).rejects.toThrow('Timed out'), vi.advanceTimersByTimeAsync(100)]);
        expect(deliverRecommendationValidationResult(outcome(id))).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        token.dispose();
    });

    it('does not submit a prompt if opening a new Chat stalled past cancellation', async () => {
        const token = new vscode.CancellationTokenSource();
        let finishNewChat!: () => void;
        vi.spyOn(vscode.commands, 'executeCommand').mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishNewChat = resolve;
                }),
        );
        const run = runRecommendationValidationChat(model, 'prompt', randomUUID(), token.token);
        token.cancel();
        await expect(run).rejects.toThrow('cancelled');
        finishNewChat();
        await Promise.resolve();
        expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
        token.dispose();
    });

    it('keeps simultaneous request destinations separate and accepts only the first report', () => {
        const firstId = randomUUID();
        const secondId = randomUUID();
        const first = vi.fn();
        const second = vi.fn();
        const a = registerRecommendationValidationRequest(firstId, first);
        const b = registerRecommendationValidationRequest(secondId, second);
        expect(deliverRecommendationValidationResult(outcome(randomUUID()))).toBe(false);
        deliverRecommendationValidationResult(outcome(secondId));
        expect(second).toHaveBeenCalledOnce();
        expect(first).not.toHaveBeenCalled();
        deliverRecommendationValidationResult(outcome(secondId));
        expect(second).toHaveBeenCalledOnce();
        a.dispose();
        expect(deliverRecommendationValidationResult(outcome(firstId))).toBe(true);
        expect(first).not.toHaveBeenCalled();
        b.dispose();
    });
});
