/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AuthenticationMethod } from '../AuthenticationMethod';
import { type CosmosDBCredential } from '../CosmosDBCredential';
import { type NoSqlQueryConnection } from '../NoSqlQueryConnection';

const mocks = vi.hoisted(() => ({
    contexts: [] as Pick<IActionContext, 'telemetry' | 'valuesToMask' | 'errorHandling'>[],
    query: vi.fn(),
    fetchNext: vi.fn(),
    getCosmosClient: vi.fn(),
}));

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (_event: string, callback: (context: unknown) => Promise<unknown>) => {
            const context = {
                telemetry: { properties: {}, measurements: {} },
                errorHandling: { issueProperties: {} },
                valuesToMask: [],
            };
            mocks.contexts.push(context);
            return callback(context);
        },
    ),
}));
vi.mock('../../chat', () => ({ CosmosDbOperationsService: {} }));
vi.mock('../../extensionVariables', () => ({ ext: { outputChannel: { error: vi.fn() } } }));
vi.mock('../priorityLevel', () => ({ resolveEffectivePriorityLevel: () => 'Low' }));
vi.mock('../getCosmosClient', () => ({
    getCosmosClient: mocks.getCosmosClient,
}));
vi.mock('./QuerySessionResult', () => ({
    QuerySessionResult: class {
        iterationsCount = 0;
        push(): void {
            this.iterationsCount++;
        }
        getResult(): undefined {
            return undefined;
        }
        getSerializedResult(): null {
            return null;
        }
    },
}));

const connection: NoSqlQueryConnection = {
    endpoint: 'https://private-account.documents.azure.com',
    databaseId: 'private-database',
    containerId: 'private-container',
    credentials: [],
    isEmulator: false,
};
const query = 'SELECT * FROM c WHERE c.secret = "private-value"';

const credentialCases: { name: string; credentials: CosmosDBCredential[]; masks: string[] }[] = [
    { name: 'no credentials', credentials: [], masks: [] },
    {
        name: 'account key',
        credentials: [{ type: AuthenticationMethod.accountKey, key: 'private-key' }],
        masks: ['private-key'],
    },
    {
        name: 'Entra ID',
        credentials: [{ type: AuthenticationMethod.entraId, tenantId: 'organization-tenant' }],
        masks: [],
    },
    {
        name: 'managed identity',
        credentials: [{ type: AuthenticationMethod.managedIdentity, clientId: 'private-client' }],
        masks: ['private-client'],
    },
    {
        name: 'multiple credentials',
        credentials: [
            { type: AuthenticationMethod.entraId, tenantId: 'organization-tenant' },
            { type: AuthenticationMethod.managedIdentity, clientId: 'private-client' },
            { type: AuthenticationMethod.entraId, tenantId: undefined },
            { type: AuthenticationMethod.managedIdentity, clientId: ' ' },
        ],
        masks: ['private-client'],
    },
];

import { QuerySession } from './QuerySession';

describe('QuerySession telemetry privacy', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.contexts.length = 0;
        mocks.query.mockReturnValue({ fetchNext: mocks.fetchNext });
        mocks.fetchNext.mockResolvedValue({});
        mocks.getCosmosClient.mockReturnValue({
            database: () => ({
                container: () => ({ items: { query: mocks.query } }),
            }),
        });
        vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);
    });

    it.each(credentialCases)(
        'registers connection masks for $name across pagination while retaining random session correlation',
        async ({ credentials, masks }) => {
            const sessionConnection = { ...connection, credentials };
            const session = new QuerySession(sessionConnection, query, { countPerPage: 10 });
            const otherSession = new QuerySession(sessionConnection, query, { countPerPage: 10 });
            expect(session.id).not.toBe(otherSession.id);

            await session.run();
            await session.nextPage();
            await session.prevPage();
            await session.firstPage();

            expect(mocks.query).toHaveBeenCalledWith(query, expect.objectContaining({ maxItemCount: 10 }));
            expect(mocks.contexts).toHaveLength(4);
            for (const context of mocks.contexts) {
                expect(context.telemetry.properties).toEqual({ sessionId: session.id, countPerPage: '10' });
                expect(context.telemetry.measurements).toEqual({});
                expect(context.valuesToMask).toEqual([
                    query,
                    ...masks,
                    connection.endpoint,
                    connection.databaseId,
                    connection.containerId,
                ]);
            }
            session.dispose();
            otherSession.dispose();
        },
    );

    it.each(credentialCases.filter(({ credentials }) => credentials.length > 0))(
        'registers connection masks for $name before client creation can fail',
        async ({ credentials, masks }) => {
            const session = new QuerySession({ ...connection, credentials }, query, { countPerPage: 10 });
            const error = new Error(`Authentication failed: ${masks.join(', ')}`);
            mocks.getCosmosClient.mockImplementationOnce(() => {
                expect(mocks.contexts[0].valuesToMask).toEqual([
                    query,
                    ...masks,
                    connection.endpoint,
                    connection.databaseId,
                    connection.containerId,
                ]);
                throw error;
            });

            const result = await session.run();

            expect(result).toMatchObject({ result: null, error: error.message });
            expect(mocks.contexts[0].telemetry.properties).toEqual({ sessionId: session.id, countPerPage: '10' });
            expect(mocks.contexts[0].errorHandling).toMatchObject({
                suppressDisplay: true,
                suppressReportIssue: true,
                rethrow: true,
            });
            session.dispose();
        },
    );
});
