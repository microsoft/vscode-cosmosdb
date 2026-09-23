/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { TypedEventSink } from '@microsoft/vscode-ext-webview';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationMethod } from '../../../cosmosdb/AuthenticationMethod';
import { type NoSqlQueryConnection } from '../../../cosmosdb/NoSqlQueryConnection';
import { TelemetryContext } from '../../../Telemetry';
import { type QueryEditorRouterContext } from '../appRouter';
import { type QueryEditorEvent } from './queryEditorEventsRouter';
import { queryEditorRouterDef } from './queryEditorRouter';

const mocks = vi.hoisted(() => ({
    contexts: [] as Pick<IActionContext, 'telemetry' | 'valuesToMask' | 'errorHandling'>[],
    read: vi.fn(),
    pickConnection: vi.fn(),
}));

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (_event: string, callback: (context: unknown) => Promise<unknown>) => {
            const context = {
                errorHandling: { issueProperties: {} },
                telemetry: { measurements: {}, properties: {} },
                valuesToMask: [],
            };
            mocks.contexts.push(context);
            return callback(context);
        },
    ),
}));
vi.mock('../../../chat', () => ({}));
vi.mock('../../../cosmosdb/controlPlane', () => ({}));
vi.mock('../../../cosmosdb/NoSqlQueryConnection', () => ({ getNoSqlQueryConnection: mocks.pickConnection }));
vi.mock('../../../cosmosdb/CosmosDBCredential', () => ({
    getCosmosDBKeyCredential: (credentials: NoSqlQueryConnection['credentials']) =>
        credentials.find((credential) => credential.type === AuthenticationMethod.accountKey),
}));
vi.mock('../../../cosmosdb/session/DocumentSession', () => ({}));
vi.mock('../../../cosmosdb/session/QuerySession', () => ({}));
vi.mock('../../../cosmosdb/throughputBuckets', () => ({}));
vi.mock('../../../cosmosdb/withClaimsChallengeHandling', () => ({
    withClaimsChallengeHandling: vi.fn(async (_connection, operation) =>
        operation({ database: () => ({ container: () => ({ read: mocks.read }) }) }),
    ),
}));
vi.mock('../../../extensionVariables', () => ({
    ext: { outputChannel: { debug: vi.fn(), warn: vi.fn() } },
}));
vi.mock('../../../services/SchemaFileStorage', () => ({}));
vi.mock('../../../services/SchemaService', () => ({}));
vi.mock('../../../services/StorageService', () => ({}));
vi.mock('../../../utils/aiUtils', () => ({}));
vi.mock('../../../utils/dialogs/getConfirmation', () => ({}));
vi.mock('../../../utils/survey', () => ({}));
vi.mock('../../../utils/vscodeUtils', () => ({}));
vi.mock('../../DocumentTab', () => ({}));
vi.mock('../../QueryEditorTab', () => ({}));

const keyCredential = { type: AuthenticationMethod.accountKey, key: 'private-account-key' } as const;
const connection: NoSqlQueryConnection = {
    endpoint: 'https://private-account.documents.azure.com',
    databaseId: 'private-database',
    containerId: 'private-container',
    credentials: [keyCredential],
    isEmulator: false,
};

function createContext(): QueryEditorRouterContext {
    return {
        webviewName: 'cosmosDbQueryEditor',
        sessions: new Map(),
        telemetryContext: new TelemetryContext('queryEditor'),
        panel: { title: 'Query Editor' } as QueryEditorRouterContext['panel'],
        eventSink: new TypedEventSink<QueryEditorEvent>(),
        state: { connection, isLastQueryAIGenerated: false, pendingRuns: new Map() },
    };
}

describe('queryEditor connection telemetry privacy', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.contexts.length = 0;
        mocks.pickConnection.mockResolvedValue(connection);
    });

    for (const method of ['setConnection', 'connectToDatabase'] as const) {
        for (const failure of ['missingContainer', 'sdkError'] as const) {
            it(`masks ${failure} in ${method} before the container read`, async () => {
                const context = createContext();
                context.state.connection = { ...connection, databaseId: 'old-database', containerId: 'old-container' };
                const error = new Error(
                    `${connection.endpoint} ${connection.databaseId} ${connection.containerId} ${keyCredential.key}`,
                );
                mocks.read.mockImplementationOnce(async () => {
                    expect(mocks.contexts).toHaveLength(1);
                    expect(mocks.contexts[0].valuesToMask).toEqual([
                        keyCredential.key,
                        connection.endpoint,
                        connection.databaseId,
                        connection.containerId,
                    ]);
                    if (failure === 'sdkError') throw error;
                    return { resource: undefined };
                });
                const caller = queryEditorRouterDef.createCaller(context);
                const operation =
                    method === 'setConnection'
                        ? caller.setConnection({
                              databaseId: connection.databaseId,
                              containerId: connection.containerId,
                          })
                        : caller.connectToDatabase();

                await expect(operation).rejects.toThrow(
                    failure === 'sdkError' ? error.message : `Container ${connection.containerId} not found`,
                );
                expect(mocks.read).toHaveBeenCalledOnce();
                expect(context.panel.title).toBe('Query Editor');
                expect(mocks.contexts[0].errorHandling.suppressDisplay).toBe(true);
                expect(mocks.contexts[0].errorHandling.suppressReportIssue).toBeUndefined();
            });
        }
    }

    it('preserves successful connection results and uses independent masks for each invocation', async () => {
        const context = createContext();
        const partitionKey = { paths: ['/pk'] };
        mocks.read.mockResolvedValue({ resource: { partitionKey } });
        const caller = queryEditorRouterDef.createCaller(context);

        expect(await caller.connectToDatabase()).toEqual({
            dbName: connection.databaseId,
            containerName: connection.containerId,
            partitionKey,
        });
        expect(await caller.setConnection({ databaseId: 'next-database', containerId: 'next-container' })).toEqual({
            dbName: 'next-database',
            containerName: 'next-container',
            partitionKey,
        });

        expect(context.panel.title).toBe('next-database/next-container');
        expect(mocks.contexts).toHaveLength(2);
        expect(mocks.contexts[0].valuesToMask).toEqual([
            keyCredential.key,
            connection.endpoint,
            connection.databaseId,
            connection.containerId,
        ]);
        expect(mocks.contexts[1].valuesToMask).toEqual([
            keyCredential.key,
            connection.endpoint,
            'next-database',
            'next-container',
        ]);
        expect(mocks.contexts[0].telemetry.properties.isEmulator).toBe('false');
    });

    it('does not resolve or mutate the connection when the picker is cancelled', async () => {
        const context = createContext();
        mocks.pickConnection.mockResolvedValueOnce(undefined);

        expect(await queryEditorRouterDef.createCaller(context).connectToDatabase()).toBeUndefined();
        expect(context.state.connection).toBe(connection);
        expect(mocks.read).not.toHaveBeenCalled();
        expect(mocks.contexts[0].valuesToMask).toEqual([]);
    });
});
