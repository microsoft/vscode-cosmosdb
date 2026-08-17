/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition } from '@azure/cosmos';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type NoSqlQueryConnection } from '../NoSqlQueryConnection';
import {
    buildIfMatchRequestOptions,
    deleteDocument,
    isPreconditionFailedError,
    replaceDocument,
} from './DocumentSession';

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

vi.mock('vscode', () => ({
    window: {},
    workspace: {},
    commands: {},
    Uri: { parse: vi.fn(), file: vi.fn() },
}));

vi.mock('@microsoft/vscode-azureresources-api', () => ({
    AzExtResourceType: { AzureCosmosDb: 'AzureCosmosDb' },
}));

vi.mock('@microsoft/vscode-azext-azureauth', () => ({
    getSessionFromVSCode: vi.fn(),
}));

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

    it('uses the loaded _etag as an IfMatch access condition', () => {
        expect(
            buildIfMatchRequestOptions({
                id: 'concurrency-proof',
                _etag: '"etag-value"',
            } as ItemDefinition),
        ).toEqual({
            accessCondition: {
                type: 'IfMatch',
                condition: '"etag-value"',
            },
        });
    });

    it('requires an _etag before updating an item', () => {
        expect(() => buildIfMatchRequestOptions({ id: 'concurrency-proof' } as ItemDefinition)).toThrow(
            'The "_etag" field is required to update an item',
        );
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

    it.each([
        ['statusCode number', { statusCode: 412 }],
        ['statusCode string', { statusCode: '412' }],
        ['code number', { code: 412 }],
        ['code string', { code: '412' }],
    ])('detects a precondition failure from %s', (_label, error) => {
        expect(isPreconditionFailedError(error)).toBe(true);
    });

    it.each([
        ['different status code', { statusCode: 500 }],
        ['different code', { code: 'Conflict' }],
        ['plain error', new Error('boom')],
        ['null', null],
    ])('does not misclassify %s', (_label, error) => {
        expect(isPreconditionFailedError(error)).toBe(false);
    });
});
