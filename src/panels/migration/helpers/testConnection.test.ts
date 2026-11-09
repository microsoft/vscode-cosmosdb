/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { TypedEventSink } from '@microsoft/vscode-ext-webview';
import { MigrationProjectService, type ProjectJson } from '../../../services/MigrationProjectService';
import { type MigrationEvent } from '../../trpc/routers/migrationEventsRouter';
import { testConnection } from './testConnection';

const { context, fetchAll } = vi.hoisted(() => ({
    context: {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
        get ui(): never {
            throw new Error('Connection test must not use UI');
        },
    } as IActionContext,
    fetchAll: vi.fn(),
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(async (_name: string, callback: (ctx: IActionContext) => Promise<void>) =>
        callback(context),
    ),
    parseError: (error: Error) => ({ message: error.message }),
}));
vi.mock('../../../cosmosdb/getCosmosClient', () => ({
    getCosmosClient: () => ({ databases: { readAll: () => ({ fetchAll }) } }),
}));
vi.mock('../../../cosmosdb/utils/rbacUtils', () => ({
    isRbacException: () => false,
    addRbacContributorPermission: vi.fn(),
}));
vi.mock('../../../cosmosdb/utils/azureSessionHelper', () => ({ getSignedInPrincipalIdForSubscription: vi.fn() }));
vi.mock('../../../extensionVariables', () => ({
    ext: { outputChannel: { error: vi.fn(), warn: vi.fn(), appendLog: vi.fn() } },
}));

describe('migration connection-test telemetry', () => {
    let project: ProjectJson;
    let service: MigrationProjectService;
    let channel: TypedEventSink<MigrationEvent>;
    beforeEach(() => {
        context.telemetry.properties = {};
        context.telemetry.measurements = {};
        context.errorHandling.issueProperties = {};
        context.valuesToMask = [];
        fetchAll.mockReset().mockResolvedValue({ resources: [] });
        project = {
            version: 1,
            name: 'private-name',
            sourceCode: 'parent',
            phases: {
                discovery: { status: 'not-started' },
                targetEnvironment: { type: 'azure', endpoint: 'https://private-account.documents.azure.com' },
            },
        };
        service = new MigrationProjectService('/workspace');
        vi.spyOn(service, 'save').mockResolvedValue(undefined);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        channel = new TypedEventSink<MigrationEvent>();
    });
    afterEach(() => {
        channel.close();
        vi.restoreAllMocks();
    });

    it('reports completed and preserves the UI success result', async () => {
        const emit = vi.spyOn(channel, 'emit');
        await testConnection({ project, projectService: service, channel, telemetrySessionId: 'host-session' });
        expect(context.telemetry.properties).toMatchObject({ outcome: 'completed', sessionId: 'host-session' });
        expect(emit).toHaveBeenCalledWith({ type: 'event', name: 'connectionTestResult', params: [{ success: true }] });
    });

    it('reports failed even when the failure is handled without rethrowing', async () => {
        fetchAll.mockRejectedValue(new Error('private-endpoint unavailable'));
        const emit = vi.spyOn(channel, 'emit');
        await testConnection({ project, projectService: service, channel });
        expect(context.telemetry.properties).toMatchObject({
            outcome: 'failed',
            result: 'Failed',
            errorCategory: 'connection',
        });
        expect(JSON.stringify(context.telemetry)).not.toContain('private-');
        expect(emit).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'connectionTestResult',
                params: [expect.objectContaining({ success: false })],
            }),
        );
    });

    it('does not report success when no target is configured', async () => {
        delete project.phases.targetEnvironment;
        await testConnection({ project, projectService: service, channel });
        expect(context.telemetry.properties).toMatchObject({ outcome: 'notConfigured' });
        expect(context.telemetry.properties.result).toBeUndefined();
        expect(fetchAll).not.toHaveBeenCalled();
    });
});
