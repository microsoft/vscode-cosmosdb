/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type NoSqlQueryConnection } from '../NoSqlQueryConnection';

const cosmosMocks = vi.hoisted(() => ({
    delete: vi.fn(),
    item: vi.fn(),
    replace: vi.fn(),
}));

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (_eventName: string, callback: (context: unknown) => Promise<unknown>) =>
            callback({
                errorHandling: { rethrow: false, suppressDisplay: false, suppressReportIssue: false },
                telemetry: { measurements: {}, properties: {} },
                valuesToMask: [],
            }),
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
});
