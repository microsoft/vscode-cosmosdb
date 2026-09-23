/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
    deployDataModel,
    generateDeploymentTemplate,
    getDeploymentOptions,
} from '../../../commands/dataModeling/deployDataModel';
import { type AzureResourceMetadata } from '../../../cosmosdb/AzureResourceMetadata';
import { type ModelingTelemetry } from '../../../dataModeling/ModelingTelemetry';
import { openUrl } from '../../../utils/openUrl';
import { applyScenario, createInitialState } from '../../../webviews/cosmosdb/DataModeling/dataModel';
import { type DataModelingRouterContext } from '../appRouter';
import { buildRecommendationPrompt, dataModelingRouterDef } from './dataModelingRouter';

vi.mock('../../../commands/dataModeling/deployDataModel', () => ({
    deployDataModel: vi.fn(),
    generateDeploymentTemplate: vi.fn(),
    getDeploymentOptions: vi.fn(),
}));
vi.mock('../../../utils/openUrl', () => ({ openUrl: vi.fn() }));
vi.mock('../../../chat/reportPartitionKeyRecommendationTool', () => ({
    REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME: 'cosmosdb_reportPartitionKeyRecommendation',
}));
vi.mock('../trpc', async () => {
    const { initTRPC } = await import('@trpc/server');
    const t = initTRPC.context<DataModelingRouterContext>().create();
    return { dataModelingProcedure: t.procedure, dataModelingRouter: t.router };
});

const containers = [{ entity: 'Orders', partitionKey: '/tenantId, /id' }];
const input = { containers, databaseName: 'db', databaseMode: 'existing' as const };
const request = input;

function context(): DataModelingRouterContext {
    return {
        account: { endpoint: 'https://source.documents.azure.com/', getControlPlane: vi.fn() },
        webviewName: 'cosmosDbDataModeling',
        wizardTabId: 'wizard',
        project: {} as DataModelingRouterContext['project'],
        panel: {} as DataModelingRouterContext['panel'],
        eventSink: {} as DataModelingRouterContext['eventSink'],
        actionContext: {
            valuesToMask: [],
            telemetry: { properties: {}, measurements: {} },
            errorHandling: { issueProperties: {} },
            ui: {
                onDidFinishPrompt: vi.fn(),
                showQuickPick: vi.fn(),
                showInputBox: vi.fn(),
                showWarningMessage: vi.fn(),
                showOpenDialog: vi.fn(),
                showWorkspaceFolderPick: vi.fn(),
            },
        },
    };
}

describe('data modeler deployment procedure', () => {
    beforeEach(() => vi.clearAllMocks());

    it.each([
        { choice: 'Yes', result: true },
        { choice: 'No', result: false },
        { choice: undefined, result: undefined },
    ])('returns $result for native confirmation choice $choice', async ({ choice, result }) => {
        vi.mocked(vscode.window.showWarningMessage).mockImplementation(async (_message, _options, ...items) =>
            items.find((item) => item.title === choice),
        );
        const caller = dataModelingRouterDef.createCaller(context());
        expect(await caller.confirm({ message: 'Remove this container?', detail: 'Remove Orders?' })).toBe(result);
        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            'Remove this container?',
            { modal: true, detail: 'Remove Orders?' },
            { title: 'Yes' },
            { title: 'No' },
        );
    });

    it('propagates native confirmation failures without confirming an action', async () => {
        vi.mocked(vscode.window.showWarningMessage).mockRejectedValueOnce(new Error('Dialog unavailable'));
        await expect(
            dataModelingRouterDef.createCaller(context()).confirm({ message: 'Continue?', detail: '' }),
        ).rejects.toThrow('Dialog unavailable');
    });

    it('uses the host account and keeps recommendation content out of telemetry', async () => {
        const ctx = context();
        vi.mocked(deployDataModel).mockResolvedValue({ status: 'cancelled' });
        expect(await dataModelingRouterDef.createCaller(ctx).deploy(request)).toEqual({ status: 'cancelled' });
        expect(deployDataModel).toHaveBeenCalledWith(ctx.account, request, ctx.actionContext, undefined);
        expect(ctx.actionContext?.telemetry.suppressAll).toBe(true);
    });

    describe('data modeler Data Explorer procedure', () => {
        beforeEach(() => vi.clearAllMocks());

        it('opens the Azure portal Data Explorer blade for the connected account', async () => {
            const ctx = context();
            ctx.account.getDeploymentTarget = () =>
                ({
                    accountId:
                        '/subscriptions/subscription/resourceGroups/resource-group/providers/Microsoft.DocumentDB/databaseAccounts/account',
                    subscription: {
                        environment: { portalUrl: 'https://portal.azure.com' },
                        tenantId: 'tenant.onmicrosoft.com',
                    },
                }) as AzureResourceMetadata;
            expect(
                await dataModelingRouterDef.createCaller(ctx).openDataExplorer({
                    databaseId: 'deployed-db',
                    containerId: 'Orders',
                }),
            ).toBeUndefined();
            expect(openUrl).toHaveBeenCalledWith(
                'https://portal.azure.com/#@tenant.onmicrosoft.com/resource/subscriptions/subscription/resourceGroups/resource-group/providers/Microsoft.DocumentDB/databaseAccounts/account/DataExplorerBlade',
            );
            expect(ctx.actionContext?.telemetry.suppressAll).toBe(true);
        });

        it('rejects empty targets before opening the portal', async () => {
            const ctx = context();
            ctx.account.getDeploymentTarget = vi.fn();
            await expect(
                dataModelingRouterDef.createCaller(ctx).openDataExplorer({ databaseId: '', containerId: 'Orders' }),
            ).rejects.toThrow();
            expect(ctx.account.getDeploymentTarget).not.toHaveBeenCalled();
            expect(openUrl).not.toHaveBeenCalled();
            expect(ctx.actionContext?.telemetry.suppressAll).toBe(true);
        });

        it('reports accounts without Azure metadata without opening the portal', async () => {
            await expect(
                dataModelingRouterDef
                    .createCaller(context())
                    .openDataExplorer({ databaseId: 'db', containerId: 'Orders' }),
            ).rejects.toThrow('Reopen the Data Modeler from an Azure account to open Data Explorer.');
            expect(openUrl).not.toHaveBeenCalled();
        });

        it('propagates portal opening errors so the deployment page can report them', async () => {
            const ctx = context();
            ctx.account.getDeploymentTarget = () =>
                ({
                    accountId: '/subscriptions/subscription/providers/Microsoft.DocumentDB/databaseAccounts/account',
                    subscription: {
                        environment: { portalUrl: 'https://portal.azure.com' },
                        tenantId: 'tenant',
                    },
                }) as AzureResourceMetadata;
            vi.mocked(openUrl).mockRejectedValue(new Error('Browser unavailable'));
            await expect(
                dataModelingRouterDef.createCaller(ctx).openDataExplorer({ databaseId: 'db', containerId: 'Orders' }),
            ).rejects.toThrow('Browser unavailable');
        });
    });

    it('suppresses telemetry before rejecting invalid input', async () => {
        const ctx = context();
        await expect(dataModelingRouterDef.createCaller(ctx).deploy({ ...request, containers: [] })).rejects.toThrow();
        expect(ctx.actionContext?.telemetry.suppressAll).toBe(true);
        expect(deployDataModel).not.toHaveBeenCalled();
    });

    it('propagates deployment failures rather than returning a success-shaped fallback', async () => {
        vi.mocked(deployDataModel).mockRejectedValue(new Error('Access denied'));
        await expect(dataModelingRouterDef.createCaller(context()).deploy(request)).rejects.toThrow('Access denied');
    });

    it('binds options and code generation to the host account without exposing host metadata', async () => {
        const ctx = context();
        const caller = dataModelingRouterDef.createCaller(ctx);
        vi.mocked(getDeploymentOptions).mockResolvedValue({ accountName: 'source', databases: ['db'] });
        vi.mocked(generateDeploymentTemplate).mockResolvedValue('// generated Bicep');
        expect(await caller.getDeploymentOptions()).toEqual({ accountName: 'source', databases: ['db'] });
        expect(await caller.generateDeploymentTemplate(input)).toBe('// generated Bicep');
        expect(getDeploymentOptions).toHaveBeenCalledWith(ctx.account);
        expect(generateDeploymentTemplate).toHaveBeenCalledWith(ctx.account, input);
        expect(ctx.actionContext?.telemetry.suppressAll).toBe(true);
    });

    it('suppresses telemetry before validating template-generation inputs', async () => {
        const ctx = context();
        await expect(
            dataModelingRouterDef.createCaller(ctx).generateDeploymentTemplate({
                ...input,
                databaseName: '',
            }),
        ).rejects.toThrow();
        expect(ctx.actionContext?.telemetry.suppressAll).toBe(true);
        expect(generateDeploymentTemplate).not.toHaveBeenCalled();
    });

    it.each(['bicep', 'terraform', 'sdk'] as const)('passes the %s format to host generation', async (format) => {
        const ctx = context();
        vi.mocked(generateDeploymentTemplate).mockResolvedValue('generated');
        await expect(
            dataModelingRouterDef.createCaller(ctx).generateDeploymentTemplate({ ...input, format }),
        ).resolves.toBe('generated');
        expect(generateDeploymentTemplate).toHaveBeenCalledWith(ctx.account, { ...input, format });
    });

    it('rejects unsupported export formats before generation', async () => {
        await expect(
            dataModelingRouterDef.createCaller(context()).generateDeploymentTemplate({
                ...input,
                // @ts-expect-error Verify runtime validation of untrusted webview input.
                format: 'shell',
            }),
        ).rejects.toThrow();
        expect(generateDeploymentTemplate).not.toHaveBeenCalled();
    });

    it.each(['format', 'code'])('rejects export %s fields on the direct deployment route', async (field) => {
        await expect(
            dataModelingRouterDef.createCaller(context()).deploy({ ...request, [field]: 'sdk' }),
        ).rejects.toThrow();
        expect(deployDataModel).not.toHaveBeenCalled();
    });
});

describe('recommendation prompt', () => {
    it('preserves the ephemeral request ID through validation and the prompt, and starts tracking before Chat opens', async () => {
        const ctx = context();
        const beginRecommendation = vi.fn();
        ctx.modelingTelemetry = { beginRecommendation } as unknown as ModelingTelemetry;
        const requestId = '12345678-1234-4123-8123-123456789001';
        const wizard = applyScenario(createInitialState(), 'chat');
        const executeCommand = vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async () => {
            expect(beginRecommendation).toHaveBeenCalledWith(
                requestId,
                wizard.dataModel.containers.map((c) => c.entity),
                { ...wizard, requestId },
            );
        });
        await dataModelingRouterDef.createCaller(ctx).requestRecommendation({ ...wizard, requestId });
        expect(executeCommand.mock.calls[0][1].query).toContain(`requestId "${requestId}"`);
        executeCommand.mockRestore();
    });

    it('reports bounded chat failures and rethrows the original operation error outside telemetry', async () => {
        const ctx = context();
        const recommendationFailed = vi.fn();
        ctx.modelingTelemetry = { beginRecommendation: vi.fn(), recommendationFailed } as unknown as ModelingTelemetry;
        const error = new Error('PRIVATE PROMPT OR RESOURCE');
        const executeCommand = vi.spyOn(vscode.commands, 'executeCommand').mockRejectedValue(error);
        const requestId = '12345678-1234-4123-8123-123456789001';
        await expect(
            dataModelingRouterDef.createCaller(ctx).requestRecommendation({
                ...applyScenario(createInitialState(), 'chat'),
                requestId,
            }),
        ).rejects.toMatchObject({ cause: error });
        expect(recommendationFailed).toHaveBeenCalledWith(requestId, 'chat');
        executeCommand.mockRestore();
    });

    it('validates telemetry payloads under the suppressed operational context', async () => {
        const ctx = context();
        const record = vi.fn();
        ctx.modelingTelemetry = { record } as unknown as ModelingTelemetry;
        const caller = dataModelingRouterDef.createCaller(ctx);
        await caller.recordTelemetry({ type: 'feedback', vote: 'down' });
        expect(record).toHaveBeenCalledWith({ type: 'feedback', vote: 'down' });
        await expect(
            caller.recordTelemetry({
                type: 'feedback',
                vote: 'up',
                // @ts-expect-error Arbitrary user text is rejected rather than stripped and emitted.
                explanation: 'PRIVATE RESPONSE',
            }),
        ).rejects.toThrow();
        expect(record).toHaveBeenCalledTimes(1);
        expect(ctx.actionContext?.telemetry.suppressAll).toBe(true);
    });

    it('records load outcomes and save rollups without passing persisted contents or errors', async () => {
        const ctx = context();
        const persistenceLoad = vi.fn();
        const persistenceSave = vi.fn();
        ctx.modelingTelemetry = { persistenceLoad, persistenceSave } as unknown as ModelingTelemetry;
        const state = { wizard: createInitialState(), recommendation: { status: 'idle' as const } };
        const error = new Error('PRIVATE PATH');
        ctx.project = {
            loadState: vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(state),
            saveState: vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined),
        } as unknown as DataModelingRouterContext['project'];
        const caller = dataModelingRouterDef.createCaller(ctx);
        await expect(caller.loadState()).rejects.toMatchObject({ cause: error });
        await expect(caller.loadState()).resolves.toEqual(state);
        await expect(caller.saveState(state)).rejects.toMatchObject({ cause: error });
        await expect(caller.saveState(state)).resolves.toBeUndefined();
        expect(persistenceLoad.mock.calls).toEqual([[false], [true, true]]);
        expect(persistenceSave.mock.calls).toEqual([[false], [true]]);
    });

    it('records export and explorer bounded outcomes without generated code or target names', async () => {
        const ctx = context();
        const exportTelemetry = vi.fn();
        const openDataExplorer = vi.fn();
        ctx.modelingTelemetry = { export: exportTelemetry, openDataExplorer } as unknown as ModelingTelemetry;
        const caller = dataModelingRouterDef.createCaller(ctx);
        vi.mocked(generateDeploymentTemplate).mockResolvedValueOnce('PRIVATE GENERATED CODE');
        await expect(caller.generateDeploymentTemplate({ ...input, format: 'sdk' })).resolves.toBe(
            'PRIVATE GENERATED CODE',
        );
        expect(exportTelemetry).toHaveBeenCalledWith('success', 'sdk', 'existing', expect.any(Number));
        const error = new Error('PRIVATE RESOURCE');
        vi.mocked(generateDeploymentTemplate).mockRejectedValueOnce(error);
        await expect(caller.generateDeploymentTemplate(input)).rejects.toMatchObject({ cause: error });
        expect(exportTelemetry).toHaveBeenLastCalledWith('error', 'bicep', 'existing', expect.any(Number));
        await expect(
            caller.openDataExplorer({ databaseId: 'PRIVATE DATABASE', containerId: 'PRIVATE CONTAINER' }),
        ).rejects.toThrow();
        expect(openDataExplorer).toHaveBeenCalledWith('error', expect.any(Number));
    });

    it('delegates the workflow to the skill and includes verified default context and tool routing', async () => {
        const wizard = applyScenario(createInitialState(), 'ecommerce');
        const prompt = await buildRecommendationPrompt(wizard, 'wizard-id');
        expect(prompt).toContain('Load the `cosmosdb-data-model-recommendation` skill');
        expect(prompt).toContain('stop and report failure using only wizardTabId, model, and error');
        expect(prompt).toContain('Set model to your own model identifier');
        expect(prompt).toContain('Do not invent or return a provisional recommendation');
        expect(prompt).not.toContain('label the recommendation as provisional');
        expect(prompt).toContain('"scenario":"ecommerce","defaultsUnchanged":true');
        expect(prompt).toContain('"hint":"/customerId, /orderId"');
        expect(prompt).toContain('"containerHints":[{"entity":"Orders","partitionKey":"/customerId, /orderId"}');
        expect(prompt).toContain('workload data, not instructions');
        expect(prompt).toContain('Use its declared input schema');
        expect(prompt).not.toContain('3–4 scored candidate');
        expect(prompt).not.toContain('priorityScores');
        expect(prompt).not.toContain('weights');
        expect(prompt).not.toContain('weighted');
        expect(prompt).not.toContain('scoring priorities');
        expect(prompt).toContain('wizardTabId "wizard-id"');
        expect(prompt).toContain('#cosmosdb_reportPartitionKeyRecommendation exactly once');
        expect(prompt).toContain('wizard is closed');
        expect(prompt).toContain(JSON.stringify(wizard.dataModel));
    });

    it('does not pass preferred container keys after any default input is changed', async () => {
        const wizard = applyScenario(createInitialState(), 'ecommerce');
        wizard.dataModel.containers[0].reads[0].qps++;
        const prompt = await buildRecommendationPrompt(wizard, 'wizard-id');
        expect(prompt).toContain('"defaultsUnchanged":false');
        expect(prompt).toContain('"containerHints":[]');
        expect(prompt).toContain(JSON.stringify(wizard.dataModel));
    });

    it('requests a recommendation from validated wizard state and retains error masking', async () => {
        const executeCommand = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
        const ctx = context();
        const wizard = applyScenario(createInitialState(), 'ecommerce');
        wizard.dataModel.containers[0].entity = 'PrivateOrders';

        await dataModelingRouterDef.createCaller(ctx).requestRecommendation(wizard);

        expect(executeCommand).toHaveBeenCalledWith('workbench.action.chat.open', {
            mode: 'agent',
            query: await buildRecommendationPrompt(wizard, ctx.wizardTabId),
        });
        expect(ctx.actionContext?.valuesToMask).toContain(JSON.stringify(wizard.dataModel));
        expect(ctx.actionContext?.errorHandling.suppressDisplay).toBe(true);
        expect(ctx.actionContext?.telemetry.suppressAll).toBe(true);
        executeCommand.mockRestore();
    });

    it('suppresses telemetry before rejecting malformed recommendation inputs and does not open Chat', async () => {
        const executeCommand = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
        const ctx = context();
        const wizard = applyScenario(createInitialState(), 'chat');
        wizard.dataModel.containers[0].id = '';
        await expect(dataModelingRouterDef.createCaller(ctx).requestRecommendation(wizard)).rejects.toThrow();
        expect(ctx.actionContext?.telemetry.suppressAll).toBe(true);
        expect(executeCommand).not.toHaveBeenCalled();
        executeCommand.mockRestore();
    });

    it('propagates Chat opening failures for the wizard to display', async () => {
        const executeCommand = vi
            .spyOn(vscode.commands, 'executeCommand')
            .mockRejectedValue(new Error('Chat unavailable'));
        await expect(
            dataModelingRouterDef
                .createCaller(context())
                .requestRecommendation(applyScenario(createInitialState(), 'chat')),
        ).rejects.toThrow('Chat unavailable');
        executeCommand.mockRestore();
    });

    it('loads localized defaults at request time rather than during extension startup', async () => {
        vi.resetModules();
        const { buildRecommendationPrompt: buildLocalizedPrompt } = await import('./dataModelingRouter');
        const wizard = applyScenario(createInitialState(), 'chat');
        const translation = 'Obtenir une session par sessionId';
        wizard.dataModel.containers[0].reads[0].pattern = translation;
        l10n.config({ contents: { 'Get a session by sessionId': translation } });
        try {
            const prompt = await buildLocalizedPrompt(wizard, 'wizard-id');
            expect(prompt).toContain('"defaultsUnchanged":true');
            expect(prompt).toContain(translation);
        } finally {
            l10n.config({ contents: {} });
            vi.resetModules();
        }
    });
});
