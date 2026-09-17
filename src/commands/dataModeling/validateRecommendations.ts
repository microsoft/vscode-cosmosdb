/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { z } from 'zod';
import { ext } from '../../extensionVariables';
import { isAIFeaturesDisabledBySetting } from '../../utils/copilotUtils';

let running = false;

/** Runtime diagnostic only; no inputs, outputs, paths, or names are emitted to telemetry. */
export async function validateRecommendations(context: IActionContext): Promise<void> {
    context.telemetry.suppressAll = true;
    if (running) {
        await vscode.window.showWarningMessage(l10n.t('Data Modeler recommendation validation is already running.'));
        return;
    }
    running = true;
    try {
        if (isAIFeaturesDisabledBySetting()) {
            throw new Error(l10n.t('Enable AI features in VS Code before validating recommendations.'));
        }
        const models = (await vscode.lm.selectChatModels({ vendor: 'copilot' })).filter(
            (model) => model.id !== 'auto' && model.name.toLowerCase() !== 'auto',
        );
        if (!models.length) {
            throw new Error(l10n.t('No language models available. Please ensure you have access to Copilot.'));
        }
        const chosen = await vscode.window.showQuickPick(
            models.map((model) => ({
                label: model.name,
                description: `${model.vendor} / ${model.family}`,
                detail: model.id,
                model,
            })),
            { title: l10n.t('Select a model for recommendation validation'), ignoreFocusOut: true },
        );
        if (!chosen) return;

        const { getScenarioList } = await import('../../webviews/cosmosdb/DataModeling/scenarios');
        const selectedScenarios = await vscode.window.showQuickPick(
            getScenarioList()
                .filter(({ id }) => id !== 'other')
                .map((scenario) => ({
                    label: scenario.title,
                    description: scenario.description,
                    picked: true,
                    scenario,
                })),
            { title: l10n.t('Select scenarios to validate'), canPickMany: true, ignoreFocusOut: true },
        );
        if (!selectedScenarios?.length) return;

        const target = await vscode.window.showSaveDialog({
            title: l10n.t('Save recommendation validation report'),
            defaultUri: vscode.Uri.joinPath(
                ext.context.globalStorageUri,
                `data-modeler-validation-${new Date().toISOString().replace(/[:.]/g, '-')}.md`,
            ),
            filters: { Markdown: ['md'] },
            saveLabel: l10n.t('Save report'),
        });
        if (!target) return;
        context.valuesToMask.push(target.toString());

        // Load localized defaults only after activation; do not read or modify any saved wizard project.
        const { applyScenario, createInitialState } = await import('../../webviews/cosmosdb/DataModeling/dataModel');
        const { createValidationReport, formatRecommendationValidationReport, runRecommendationValidation } =
            await import('../../dataModeling/recommendationValidation');
        const scenarios = selectedScenarios.map(({ scenario: { id, title } }) => ({
            id,
            title,
            wizard: applyScenario(createInitialState(), id),
        }));
        const confirm = l10n.t('Run validation');
        if (
            (await vscode.window.showWarningMessage(
                l10n.t(
                    'Validate selected scenarios ({count}) in Copilot Chat with {model}? This opens a new Chat per scenario and consumes Copilot quota. Finish any current Chat work first. Keep the model unchanged and respond to Chat approvals as needed. The summary includes model keys, rationales, and failure reasons.',
                    { count: scenarios.length, model: chosen.model.name },
                ),
                { modal: true },
                confirm,
            )) !== confirm
        )
            return;

        const report = createValidationReport(
            scenarios,
            chosen.model,
            z.object({ version: z.string() }).parse(ext.context.extension.packageJSON).version,
        );
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: l10n.t('Validating Data Modeler recommendations'),
                cancellable: true,
            },
            async (progress, token) =>
                runRecommendationValidation(
                    report,
                    chosen.model,
                    token,
                    async (current) => {
                        await vscode.workspace.fs.writeFile(
                            target,
                            Buffer.from(formatRecommendationValidationReport(current)),
                        );
                    },
                    (title, index, count) =>
                        progress.report({
                            message: l10n.t('{index}/{count}: {scenario}', {
                                index: index + 1,
                                count,
                                scenario: title,
                            }),
                            increment: index === 0 ? 0 : 100 / count,
                        }),
                ),
        );
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
        const incompleteCount = report.results.filter((result) => result.status !== 'completed').length;
        if (incompleteCount > 0) {
            await vscode.window.showWarningMessage(
                l10n.t(
                    'Validation report saved. Scenarios without a recommendation: {count}. See the summary for failure or cancellation reasons.',
                    { count: incompleteCount },
                ),
            );
        } else {
            await vscode.window.showInformationMessage(l10n.t('Recommendation validation report saved.'));
        }
    } finally {
        running = false;
    }
}
