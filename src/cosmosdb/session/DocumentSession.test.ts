/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationMethod } from '../AuthenticationMethod';
import { getCosmosDBKeyCredential } from '../CosmosDBCredential';
import { type NoSqlQueryConnection } from '../NoSqlQueryConnection';

const cosmosMocks = vi.hoisted(() => ({
    delete: vi.fn(),
    item: vi.fn(),
    replace: vi.fn(),
    read: vi.fn(),
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
                container: () => ({ item: cosmosMocks.item, read: cosmosMocks.read }),
            }),
        }),
    ),
}));

import { buildNewDocumentTemplate, deleteDocument, getPartitionKey, replaceDocument } from './DocumentSession';

const connection: NoSqlQueryConnection = {
    containerId: 'container',
    credentials: [],
    databaseId: 'database',
    endpoint: 'https://localhost',
    isEmulator: true,
};
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
        vi.mocked(getCosmosDBKeyCredential).mockReturnValue(undefined);
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

describe('partition-key lookup telemetry privacy', () => {
    const keyCredential = { type: AuthenticationMethod.accountKey, key: 'private-account-key' } as const;
    const keyConnection = { ...connection, credentials: [keyCredential] };

    beforeEach(() => {
        vi.clearAllMocks();
        telemetryContexts.length = 0;
        vi.mocked(getCosmosDBKeyCredential).mockReturnValue(keyCredential);
    });

    function expectLookupMasks(): void {
        const context = telemetryContexts.at(-1);
        expect(context?.valuesToMask).toEqual([
            keyCredential.key,
            connection.endpoint,
            connection.databaseId,
            connection.containerId,
        ]);
        expect(context?.errorHandling).toMatchObject({
            rethrow: true,
            suppressDisplay: false,
            suppressReportIssue: false,
        });
        expect(context?.telemetry).toEqual({ measurements: {}, properties: {} });
    }

    it('masks a missing-container failure when building a template without an outer telemetry event', async () => {
        cosmosMocks.read.mockImplementationOnce(async () => {
            expectLookupMasks();
            return { resource: undefined };
        });

        await expect(buildNewDocumentTemplate(keyConnection)).rejects.toThrow('Container container not found');
        expect(telemetryContexts).toHaveLength(1);
    });

    it('masks an SDK failure in the inner lookup context independently of the outer document operation', async () => {
        cosmosMocks.item.mockReturnValue({ replace: cosmosMocks.replace });
        cosmosMocks.replace.mockResolvedValueOnce({ resource: document });
        const error = new Error(
            `${connection.endpoint} ${connection.databaseId} ${connection.containerId} ${keyCredential.key}`,
        );
        cosmosMocks.read.mockImplementationOnce(async () => {
            expect(telemetryContexts).toHaveLength(2);
            expectLookupMasks();
            expect(telemetryContexts[0]).not.toBe(telemetryContexts[1]);
            throw error;
        });

        await expect(replaceDocument(keyConnection, document, identifier)).rejects.toBe(error);
        expect(cosmosMocks.replace).toHaveBeenCalledOnce();
    });

    it('preserves the known partition-key fast path without a telemetry event or container read', async () => {
        const partitionKey = { paths: ['/pk'] };

        expect(await getPartitionKey(keyConnection, partitionKey)).toBe(partitionKey);
        expect(telemetryContexts).toHaveLength(0);
        expect(cosmosMocks.read).not.toHaveBeenCalled();
    });

    it('preserves successful lookup results and excludes blank masks without a key credential', async () => {
        vi.mocked(getCosmosDBKeyCredential).mockReturnValue(undefined);
        const partitionKey = { paths: ['/pk'] };
        cosmosMocks.read.mockResolvedValueOnce({ resource: { partitionKey } });

        expect(await getPartitionKey({ ...connection, databaseId: ' ', containerId: '' })).toBe(partitionKey);
        expect(telemetryContexts[0].valuesToMask).toEqual([connection.endpoint]);
    });
});
