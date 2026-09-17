/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import packageJson from '../../../package.json';
import packageNls from '../../../package.nls.json';
import { runRecommendationValidation } from '../../dataModeling/recommendationValidation';
import type * as validationModule from '../../dataModeling/recommendationValidation';
import { isAIFeaturesDisabledBySetting } from '../../utils/copilotUtils';
import { createMockLanguageModel } from '../../utils/languageModelMockUtils';
import { validateRecommendations } from './validateRecommendations';

vi.mock('../../chat/reportPartitionKeyRecommendationTool', () => ({
    REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME: 'cosmosdb_reportPartitionKeyRecommendation',
}));
vi.mock('vscode', async () => {
    const actual = await vi.importActual<typeof vscode>('vscode');
    return { ...actual, lm: { ...actual.lm, selectChatModels: vi.fn() } };
});
vi.mock('../../utils/copilotUtils', () => ({ isAIFeaturesDisabledBySetting: vi.fn(() => false) }));
vi.mock('../../extensionVariables', async () => {
    const { Uri } = await import('vscode');
    return {
        ext: {
            context: {
                globalStorageUri: Uri.file('C:\\validation-reports'),
                extensionPath: 'C:\\extension',
                extension: { packageJSON: { version: '0.37.2' } },
            },
        },
    };
});
vi.mock('../../dataModeling/recommendationValidation', async () => {
    const actual = await vi.importActual<typeof validationModule>('../../dataModeling/recommendationValidation');
    return { ...actual, runRecommendationValidation: vi.fn() };
});

const model = createMockLanguageModel({ id: 'chosen-id', name: 'Chosen model', resolveResponse: () => '' });
const target = vscode.Uri.file('C:\\reports\\recommendations.md');
function context() {
    return { telemetry: {}, valuesToMask: [] } as unknown as IActionContext;
}

beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.mocked(isAIFeaturesDisabledBySetting).mockReturnValue(false);
    vi.mocked(runRecommendationValidation).mockReset();
    vi.spyOn(vscode.lm, 'selectChatModels').mockResolvedValue([model]);
    vi.spyOn(vscode.window, 'showQuickPick').mockImplementation(async (items, options) => {
        const choices = await items;
        return options?.canPickMany ? (choices as never) : choices[0];
    });
    vi.spyOn(vscode.window, 'showSaveDialog').mockResolvedValue(target);
    vi.spyOn(vscode.window, 'showWarningMessage').mockImplementation(async () => 'Run validation' as never);
    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
    vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue({} as vscode.TextEditor);
    vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({} as vscode.TextDocument);
    vi.spyOn(vscode.workspace.fs, 'writeFile').mockResolvedValue(undefined);
    vi.spyOn(vscode.workspace.fs, 'createDirectory').mockResolvedValue(undefined);
    vi.spyOn(vscode.window, 'withProgress').mockImplementation(async (_options, task) =>
        task({ report: vi.fn() }, new vscode.CancellationTokenSource().token),
    );
    vi.mocked(runRecommendationValidation).mockImplementation(async (report, _model, _token, checkpoint) => {
        for (const result of report.results) result.status = 'completed';
        report.finished = true;
        await checkpoint(report);
    });
});

describe('runtime recommendation validation command', () => {
    it('is available in the command palette with a localized title', () => {
        expect(packageJson.contributes.commands).toContainEqual({
            category: 'Cosmos DB',
            command: 'cosmosDB.dataModeling.validateRecommendations',
            title: '%cosmosdb.command.dataModeling.validateRecommendations%',
        });
        expect(packageNls['cosmosdb.command.dataModeling.validateRecommendations']).toBe(
            'Validate Data Modeler Recommendations',
        );
    });

    it('enables all built-in wizard scenarios with the exact selected model and opens a saved summary', async () => {
        const ctx = context();
        await validateRecommendations(ctx);
        expect(ctx.telemetry.suppressAll).toBe(true);
        expect(ctx.valuesToMask).toContain(target.toString());
        expect(runRecommendationValidation).toHaveBeenCalledOnce();
        const [report, selectedModel] = vi.mocked(runRecommendationValidation).mock.calls[0];
        expect(selectedModel).toBe(model);
        expect(report.results).toHaveLength(15);
        expect(report.results[0].scenario.id).toBe('chat');
        expect(report.results.flatMap((result) => result.scenario.wizard.dataModel.containers)).toHaveLength(24);
        expect(report.results.some((result) => result.scenario.id === 'other')).toBe(false);
        const [choices, options] = vi.mocked(vscode.window.showQuickPick).mock.calls[1];
        expect(options).toMatchObject({ canPickMany: true });
        expect(await choices).toEqual(expect.arrayContaining([expect.objectContaining({ picked: true })]));
        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            expect.stringContaining('Validate selected scenarios (15) in Copilot Chat'),
            { modal: true },
            'Run validation',
        );
        const [uri, bytes] = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
        expect(uri).toEqual(target);
        expect(Buffer.from(bytes).toString()).toContain('chosen-id');
        expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(target);
        expect(vscode.window.showTextDocument).toHaveBeenCalledOnce();
    });

    it('does not silently substitute another model or select Auto', async () => {
        const auto = createMockLanguageModel({ id: 'auto', name: 'Auto', resolveResponse: () => '' });
        vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([auto, model]);
        await validateRecommendations(context());
        const [items] = vi.mocked(vscode.window.showQuickPick).mock.calls[0];
        expect(items).toHaveLength(1);
        expect(vi.mocked(runRecommendationValidation).mock.calls[0][1]).toBe(model);
    });

    it('can select a non-first scenario without including any other workload', async () => {
        vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items, options) => {
            const choices = await items;
            return options?.canPickMany ? ([choices[8]] as never) : choices[0];
        });
        await validateRecommendations(context());
        const [report] = vi.mocked(runRecommendationValidation).mock.calls[0];
        expect(report.results).toHaveLength(1);
        expect(report.results[0].scenario.id).toBe('profiles');
        expect(report.results[0].scenario.wizard.dataModel.containers).toHaveLength(1);
        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            expect.stringContaining('Validate selected scenarios (1) in Copilot Chat'),
            { modal: true },
            'Run validation',
        );
    });

    it.each(['model', 'scenario', 'empty scenarios', 'save', 'confirm'])(
        'does not invoke a model when %s selection is cancelled',
        async (step) => {
            if (step === 'model') vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);
            if (step === 'scenario') {
                vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items, options) =>
                    options?.canPickMany ? undefined : (await items)[0],
                );
            }
            if (step === 'empty scenarios') {
                vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items, options) =>
                    options?.canPickMany ? ([] as never) : (await items)[0],
                );
            }
            if (step === 'save') vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined);
            if (step === 'confirm') vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
            await validateRecommendations(context());
            expect(runRecommendationValidation).not.toHaveBeenCalled();
            expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
        },
    );

    it('fails clearly when AI is disabled or no usable model exists', async () => {
        vi.mocked(isAIFeaturesDisabledBySetting).mockReturnValue(true);
        await expect(validateRecommendations(context())).rejects.toThrow('Enable AI features');
        vi.mocked(isAIFeaturesDisabledBySetting).mockReturnValue(false);
        vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([]);
        await expect(validateRecommendations(context())).rejects.toThrow('No language models available');
        expect(runRecommendationValidation).not.toHaveBeenCalled();
    });

    it('surfaces report write failures and releases the running guard', async () => {
        vi.mocked(vscode.workspace.fs.writeFile).mockRejectedValueOnce(new Error('Disk full'));
        await expect(validateRecommendations(context())).rejects.toThrow('Disk full');
        expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
        await validateRecommendations(context());
        expect(runRecommendationValidation).toHaveBeenCalledTimes(2);
    });

    it('warns when the report contains failures or incomplete scenarios', async () => {
        vi.mocked(runRecommendationValidation).mockImplementation(async (report) => {
            for (const result of report.results) result.status = 'completed';
            report.results[1].status = 'failed';
            report.results[1].error = 'Missing guidance';
            report.finished = true;
        });
        await validateRecommendations(context());
        expect(vscode.window.showWarningMessage).toHaveBeenLastCalledWith(
            'Validation report saved. Scenarios without a recommendation: 1. See the summary for failure or cancellation reasons.',
        );
    });

    it('does not allow overlapping validation runs', async () => {
        let release!: () => void;
        let started!: () => void;
        const runningStarted = new Promise<void>((resolve) => {
            started = resolve;
        });
        vi.mocked(runRecommendationValidation).mockImplementationOnce(async () => {
            started();
            await new Promise<void>((resolve) => {
                release = resolve;
            });
        });
        const first = validateRecommendations(context());
        await runningStarted;
        await validateRecommendations(context());
        expect(vscode.window.showWarningMessage).toHaveBeenLastCalledWith(
            'Data Modeler recommendation validation is already running.',
        );
        expect(runRecommendationValidation).toHaveBeenCalledOnce();
        release();
        await first;
    });
});
