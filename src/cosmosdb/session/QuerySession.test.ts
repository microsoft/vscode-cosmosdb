/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type NoSqlQueryConnection } from '../NoSqlQueryConnection';

const mocks = vi.hoisted(() => ({
    contexts: [] as Pick<IActionContext, 'telemetry' | 'valuesToMask' | 'errorHandling'>[],
    query: vi.fn(),
    fetchNext: vi.fn(),
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
vi.mock('../../extensionVariables', () => ({ ext: {} }));
vi.mock('../CosmosDBCredential', () => ({ getCosmosDBKeyCredential: () => undefined }));
vi.mock('../priorityLevel', () => ({ resolveEffectivePriorityLevel: () => 'Low' }));
vi.mock('../getCosmosClient', () => ({
    getCosmosClient: () => ({
        database: () => ({
            container: () => ({ items: { query: mocks.query } }),
        }),
    }),
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

import { QuerySession } from './QuerySession';

describe('QuerySession telemetry privacy', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.contexts.length = 0;
        mocks.query.mockReturnValue({ fetchNext: mocks.fetchNext });
        mocks.fetchNext.mockResolvedValue({});
    });

    it('retains random session correlation across pagination without emitting sensitive values or hashes', async () => {
        const session = new QuerySession(connection, query, { countPerPage: 10 });
        const otherSession = new QuerySession(connection, query, { countPerPage: 10 });
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
                connection.endpoint,
                connection.databaseId,
                connection.containerId,
            ]);
        }
        session.dispose();
        otherSession.dispose();
    });
});
