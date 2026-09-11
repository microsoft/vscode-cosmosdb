/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
    deployDataModel,
    generateDeploymentTemplate,
    getDeploymentOptions,
} from '../../../commands/dataModeling/deployDataModel';
import { type DataModelingRouterContext } from '../appRouter';
import { buildRecommendationPrompt, dataModelingRouterDef } from './dataModelingRouter';

vi.mock('../../../commands/dataModeling/deployDataModel', () => ({
    deployDataModel: vi.fn(),
    generateDeploymentTemplate: vi.fn(),
    getDeploymentOptions: vi.fn(),
}));
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

    it('uses the host account and keeps recommendation content out of telemetry', async () => {
        const ctx = context();
        vi.mocked(deployDataModel).mockResolvedValue({ status: 'cancelled' });
        expect(await dataModelingRouterDef.createCaller(ctx).deploy(request)).toEqual({ status: 'cancelled' });
        expect(deployDataModel).toHaveBeenCalledWith(ctx.account, request, ctx.actionContext);
        expect(ctx.actionContext?.telemetry.suppressAll).toBe(true);
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
});

describe('recommendation prompt', () => {
    it('requires detailed skill reading and model-supplied scores and verdicts', () => {
        const prompt = buildRecommendationPrompt('{"containers":[]}', 'wizard-id');
        expect(prompt).toContain('cosmosdb-best-practices');
        expect(prompt).toContain('Reading only the skill overview is not sufficient');
        expect(prompt).toContain('label the recommendation as provisional');
        expect(prompt).toContain('3–4 scored candidate keys ordered best first');
        expect(prompt).toContain('`verdict` (recommended / alternative / avoid)');
        expect(prompt).toContain('`score` 0–100');
        expect(prompt).toContain('Immutability');
        expect(prompt).not.toContain('priorityScores');
        expect(prompt).not.toContain('weights');
        expect(prompt).not.toContain('weighted');
        expect(prompt).not.toContain('scoring priorities');
        expect(prompt).toContain('wizardTabId "wizard-id"');
        expect(prompt).toContain('{"containers":[]}');
    });

    it('requests a recommendation without weights and retains error masking', async () => {
        const executeCommand = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
        const ctx = context();
        const dataModelJson = '{"containers":[{"entity":"PrivateOrders"}]}';

        await dataModelingRouterDef.createCaller(ctx).requestRecommendation({ dataModelJson });

        expect(executeCommand).toHaveBeenCalledWith('workbench.action.chat.open', {
            mode: 'agent',
            query: buildRecommendationPrompt(dataModelJson, ctx.wizardTabId),
        });
        expect(ctx.actionContext?.valuesToMask).toContain(dataModelJson);
        expect(ctx.actionContext?.errorHandling.suppressDisplay).toBe(true);
        executeCommand.mockRestore();
    });
});
