/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type NoSqlQueryConnection } from '../NoSqlQueryConnection';

const cosmosMocks = vi.hoisted(() => ({
    delete: vi.fn(),
    item: vi.fn(),
    replace: vi.fn(),
}));

const telemetryContexts = vi.hoisted(
    () => [] as Pick<IActionContext, 'telemetry' | 'valuesToMask' | 'errorHandling'>[],
);

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (_eventName: string, callback: (context: unknown) => Promise<unknown>) => {
            const context = {
                errorHandling: {
                    rethrow: false,
                    suppressDisplay: false,
                    suppressReportIssue: false,
                    issueProperties: {},
                },
                telemetry: { measurements: {}, properties: {} },
                valuesToMask: [],
            };
            telemetryContexts.push(context);
            return callback(context);
        },
    ),
}));
vi.mock('../../extensionVariables', () => ({ ext: {} }));
vi.mock('../CosmosDBCredential', () => ({ getCosmosDBKeyCredential: vi.fn() }));
vi.mock('../priorityLevel', () => ({ resolveEffectivePriorityLevel: vi.fn() }));
vi.mock('../withClaimsChallengeHandling', () => ({
    withClaimsChallengeHandling: vi.fn(async (_connection, operation) =>
        operation({
            database: () => ({
                container: () => ({ item: cosmosMocks.item }),
            }),
        }),
    ),
}));

import { deleteDocument, replaceDocument } from './DocumentSession';

const connection = {
    containerId: 'container',
    credentials: {},
    databaseId: 'database',
    endpoint: 'https://localhost',
} as NoSqlQueryConnection;
const identifier = { id: 'item', _rid: 'rid', partitionKey: 'pk' };
const document = {
    id: 'item',
    pk: 'pk',
    _rid: 'rid',
    _ts: 1,
    _self: 'self',
    _etag: 'new-etag',
    _attachments: 'attachments/',
};

describe('DocumentSession ETag conditions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        telemetryContexts.length = 0;
        cosmosMocks.item.mockReturnValue({ delete: cosmosMocks.delete, replace: cosmosMocks.replace });
    });

    it('passes IfMatch when replacing a document', async () => {
        cosmosMocks.replace.mockResolvedValue({ resource: document });

        await replaceDocument(connection, document, identifier, undefined, { paths: ['/pk'] }, 'loaded-etag');

        expect(cosmosMocks.replace).toHaveBeenCalledWith(
            document,
            expect.objectContaining({
                accessCondition: { type: 'IfMatch', condition: 'loaded-etag' },
            }),
        );
    });

    it('passes IfMatch when deleting a partition-key move source', async () => {
        cosmosMocks.delete.mockResolvedValue({ statusCode: 204 });

        await deleteDocument(connection, identifier, undefined, 'loaded-etag');

        expect(cosmosMocks.delete).toHaveBeenCalledWith(
            expect.objectContaining({
                accessCondition: { type: 'IfMatch', condition: 'loaded-etag' },
            }),
        );
    });

    it('masks connection names without emitting names or hashes for document writes and deletes', async () => {
        cosmosMocks.replace.mockResolvedValue({ resource: document });
        cosmosMocks.delete.mockResolvedValue({ statusCode: 204 });

        await replaceDocument(connection, document, identifier, undefined, { paths: ['/pk'] }, 'loaded-etag');
        await deleteDocument(connection, identifier, undefined, 'loaded-etag');

        expect(telemetryContexts).toHaveLength(2);
        for (const context of telemetryContexts) {
            expect(context.telemetry.properties).toEqual({});
            expect(context.telemetry.measurements).toEqual({});
            expect(context.valuesToMask).toEqual(
                expect.arrayContaining([connection.endpoint, connection.databaseId, connection.containerId]),
            );
            expect(context.valuesToMask).not.toContain('');
        }
    });
});
