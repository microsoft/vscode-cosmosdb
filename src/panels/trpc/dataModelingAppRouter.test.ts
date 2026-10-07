/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { TypedEventSink } from '@microsoft/vscode-ext-webview';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDeploymentTemplate, getDeploymentOptions } from '../../commands/dataModeling/deployDataModel';
import { dataModelingAppRouter, dataModelingCallerFactory, type DataModelingRouterContext } from './appRouter';

vi.mock('../../commands/dataModeling/deployDataModel', () => ({
    deployDataModel: vi.fn(),
    generateDeploymentTemplate: vi.fn(),
    getDeploymentOptions: vi.fn(),
}));
vi.mock('../../chat/reportPartitionKeyRecommendationTool', () => ({
    REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME: 'cosmosdb_reportPartitionKeyRecommendation',
}));
vi.mock('../../extensionVariables', () => ({
    ext: { outputChannel: { debug: vi.fn(), warn: vi.fn() } },
}));
vi.mock('../../utils/survey', () => ({ openSurvey: vi.fn(), promptAfterActionEventually: vi.fn() }));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: async (
        _event: string,
        callback: (context: IActionContext) => Promise<unknown>,
    ) => callback(actionContext()),
}));

// Only unrelated webview routers are stubbed. The Data Modeler uses the real framework, middleware and router assembly.
vi.mock('./routers/accountOverviewRouter', async () => ({
    accountOverviewRouterDef: (await import('@microsoft/vscode-ext-webview')).initWebviewTrpc().router({}),
}));
vi.mock('./routers/documentRouter', async () => ({
    documentRouterDef: (await import('@microsoft/vscode-ext-webview')).initWebviewTrpc().router({}),
}));
vi.mock('./routers/migrationRouter', async () => ({
    migrationRouterDef: (await import('@microsoft/vscode-ext-webview')).initWebviewTrpc().router({}),
}));
vi.mock('./routers/migrationEventsRouter', async () => ({
    migrationEventsRouterDef: (await import('@microsoft/vscode-ext-webview')).initWebviewTrpc().router({}),
}));
vi.mock('./routers/queryEditorRouter', async () => ({
    queryEditorRouterDef: (await import('@microsoft/vscode-ext-webview')).initWebviewTrpc().router({}),
}));
vi.mock('./routers/queryEditorEventsRouter', async () => ({
    queryEditorEventsRouterDef: (await import('@microsoft/vscode-ext-webview')).initWebviewTrpc().router({}),
}));
vi.mock('./routers/quickStartRouter', async () => ({
    quickStartRouterDef: (await import('@microsoft/vscode-ext-webview')).initWebviewTrpc().router({}),
}));

function actionContext(): IActionContext {
    return {
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
    };
}

describe('assembled Data Modeler host router', () => {
    beforeEach(() => vi.clearAllMocks());

    it('registers all deployment procedures under the paths called by the webview', () => {
        for (const path of [
            'dataModeling.getDeploymentOptions',
            'dataModeling.generateDeploymentTemplate',
            'dataModeling.deploy',
        ] as const) {
            expect(dataModelingAppRouter._def.procedures).toHaveProperty([path]);
        }
    });

    it('dispatches database loading and Bicep generation through the actual host caller factory', async () => {
        const ctx: DataModelingRouterContext = {
            account: { endpoint: 'https://source.documents.azure.com/', name: 'source' },
            webviewName: 'cosmosDbDataModeling',
            wizardTabId: 'wizard',
            project: {} as DataModelingRouterContext['project'],
            panel: {} as DataModelingRouterContext['panel'],
            eventSink: new TypedEventSink(),
        };
        const caller = dataModelingCallerFactory(dataModelingAppRouter)(ctx);
        vi.mocked(getDeploymentOptions).mockResolvedValue({ accountName: 'source', databases: ['existing'] });
        vi.mocked(generateDeploymentTemplate).mockResolvedValue('// generated Bicep');
        const input = {
            databaseMode: 'existing' as const,
            databaseName: 'existing',
            containers: [{ entity: 'Orders', partitionKey: '/id' }],
        };
        expect(await caller.dataModeling.getDeploymentOptions()).toEqual({
            accountName: 'source',
            databases: ['existing'],
        });
        expect(await caller.dataModeling.generateDeploymentTemplate(input)).toBe('// generated Bicep');
        expect(getDeploymentOptions).toHaveBeenCalledWith(ctx.account);
        expect(generateDeploymentTemplate).toHaveBeenCalledWith(ctx.account, input);
        ctx.eventSink.close();
    });
});
