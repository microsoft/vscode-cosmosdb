/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { classifyLogsFailure, createLogsDiagnostic, LogsFetchError } from './logsDiagnostics';

describe('classifyLogsFailure', () => {
    it.each([
        { statusCode: 401 },
        { response: { status: '403' } },
        { response: { statusCode: 401 } },
        { details: { error: { code: 'InsufficientAccessError' } } },
        { innererror: { code: 'AuthorizationFailedError' } },
        { innerError: { details: [{ code: 'Forbidden' }] } },
        { body: { error: { innererror: { code: 'Unauthorized' } } } },
        { response: { parsedBody: { error: { code: 'AccessDenied' } } } },
    ])('classifies nested SDK access failures: %j', (error) => {
        expect(classifyLogsFailure(error)).toEqual({ reason: 'rbac', kind: 'accessDenied' });
    });

    it.each([
        "Failed to resolve table or column expression named 'CDBDataPlaneRequests'",
        "Failed to resolve table 'CDBQueryRuntimeStatistics'",
        'CDBQueryRuntimeStatistics not found',
        "Table 'CDBDataPlaneRequests' does not exist",
    ])('requires evidence of the missing diagnostic table: %s', (message) => {
        expect(classifyLogsFailure({ details: { error: { innererror: { code: 'SemanticError', message } } } })).toEqual(
            {
                reason: 'logAnalyticsDisabled',
                kind: 'missingTable',
            },
        );
    });

    it.each([
        "Failed to resolve scalar expression named 'MissingColumn' in CDBDataPlaneRequests",
        "Failed to resolve column 'CDBDataPlaneRequests'",
        "Column 'CDBDataPlaneRequests' not found",
        "Failed to resolve table 'OtherTable'; query uses CDBDataPlaneRequests",
        'Syntax error in CDBQueryRuntimeStatistics',
        'CDBDataPlaneRequests was queried successfully; MissingColumn not found',
        "Failed to resolve table 'CDBDataPlaneRequestsBackup'",
    ])('does not confuse query errors with missing tables: %s', (message) => {
        expect(classifyLogsFailure({ code: 'SemanticError', message })).toEqual({
            reason: 'noData',
            kind: 'queryError',
        });
    });

    it.each([
        [{ statusCode: 429 }, 'transient'],
        [{ statusCode: 503 }, 'transient'],
        [{ code: 'ETIMEDOUT' }, 'transient'],
        [{ code: 'PartialError' }, 'partialFailure'],
        [{ code: 'BadArgumentError' }, 'queryError'],
        [new Error('unfamiliar server reason'), 'unknown'],
    ])('distinguishes failures while preserving noData: %j', (error, kind) => {
        expect(classifyLogsFailure(error)).toEqual({ reason: 'noData', kind });
    });
});

describe('createLogsDiagnostic', () => {
    it('keeps nested useful reasons and deduplicated codes, without traversing SDK payload fields', () => {
        const error = {
            code: 'BadArgumentError',
            message: 'The request had invalid properties.',
            details: {
                error: {
                    code: 'BadArgumentError',
                    message: 'The request had invalid properties.',
                    innererror: {
                        code: 'InsufficientAccessError',
                        message: 'Insufficient access to query the resource.',
                        additionalProperties: { code: 'Forbidden', message: 'PRIVATE_DOCUMENT' },
                    },
                    details: [{ code: 'PermissionError', message: 'Reader access required.', value: 'PRIVATE_VALUE' }],
                },
            },
            request: { message: 'PRIVATE_REQUEST' },
            response: { status: 403, headers: { message: 'PRIVATE_HEADER' }, body: 'PRIVATE_BODY' },
            toJSON: () => {
                throw new Error('Never serialize errors');
            },
        };
        expect(createLogsDiagnostic(error, 'crossPartition')).toEqual({
            operation: 'crossPartition',
            reason: 'rbac',
            kind: 'accessDenied',
            statusCode: 403,
            codes: ['BadArgumentError', 'InsufficientAccessError', 'PermissionError'],
            messages: [
                'The request had invalid properties.',
                'Insufficient access to query the resource.',
                'Reader access required.',
            ],
        });
    });

    it('redacts known names, query text, credentials, URLs, resource IDs, GUIDs and quoted values', () => {
        const query = 'CDBDataPlaneRequests | summarize count()';
        const values = [
            'privateDatabase',
            'privateContainer',
            'privateAccount',
            '/subscriptions/sub/resourceGroups/group/providers/Microsoft.DocumentDB/databaseAccounts/account',
            'https://private.example/path?sig=PRIVATE_SIGNATURE',
            '12345678-1234-1234-1234-123456789abc',
            'PRIVATE_BEARER',
            'PRIVATE_LITERAL',
            'PRIVATE_IDENTIFIER',
            'eyJhbGciOiJub25lIn0.eyJzdWIiOiJzZWNyZXQifQ.signature',
        ];
        const diagnostic = createLogsDiagnostic(
            {
                code: 'SemanticError',
                message:
                    `Insufficient access for ${values.slice(0, 6).join(' ')} ` +
                    `Bearer ${values[6]} '${values[7]}' "${values[8]}" ${values[9]} ${query}`,
            },
            'crossPartition',
            { sensitiveValues: ['privateDatabase', 'privateContainer', 'privateAccount', query] },
        );
        expect(diagnostic.messages.join(' ')).toContain('Insufficient access');
        for (const value of [...values, query, 'PRIVATE_SIGNATURE']) {
            expect(diagnostic.messages.join(' ')).not.toContain(value);
        }
    });

    it.each([
        'Failure: query: CDBDataPlaneRequests | where name == privateLiteral',
        'Failure: SELECT secretDocument FROM customerData',
        'Failure: {"secretDocument": "customerData"}',
        'Failure: [secretDocument, customerData]',
        "Failure: 'unterminated secretDocument customerData",
        'Failure: token=secretDocument password=customerData',
        'Failure: password="secretDocument customerData"',
        "Failure: secret='secretDocument customerData'",
        "Failure: Bearer 'secretDocument customerData'",
        'Failure: password="secretDocument customerData',
        "Failure: secret='secretDocument customerData",
    ])('redacts embedded data and query snippets: %s', (message) => {
        const diagnostic = createLogsDiagnostic({ message }, 'ingestionSummary');
        expect(diagnostic.messages[0]).toContain('Failure:');
        expect(diagnostic.messages[0]).not.toMatch(/secretDocument|customerData|privateLiteral|CDBDataPlaneRequests/);
    });

    it('accepts only bounded identifier codes and canonical request IDs', () => {
        const error = {
            code: 'bad code Bearer secret',
            requestId: 'id\r\nBearer PRIVATE_TOKEN',
            details: [
                { code: 'A'.repeat(100) },
                { code: 'privateDatabaseError' },
                { code: 'a2345678-1234-1234-1234-123456789abc' },
                { code: 'Safe.Code-1' },
                { code: 'Safe.Code-1' },
            ],
        };
        expect(createLogsDiagnostic(error, 'client', { sensitiveValues: ['privateDatabase'] })).toMatchObject({
            kind: 'clientUnavailable',
            codes: ['Safe.Code-1'],
        });
        expect(createLogsDiagnostic(error, 'client')).not.toHaveProperty('requestId');
        expect(
            createLogsDiagnostic({ requestId: '12345678-1234-1234-1234-123456789abc' }, 'probeDataPlane').requestId,
        ).toBe('12345678-1234-1234-1234-123456789abc');
    });

    it('handles cycles, excessive nesting, oversized messages and throwing getters without serialization', () => {
        const error: Record<string, unknown> = {
            message: 'Insufficient access.',
            details: Array.from({ length: 1000 }, (_, index) => ({ code: `Error${index}`, message: 'A'.repeat(1000) })),
            body: 'PRIVATE_RAW_BODY',
        };
        error.innererror = error;
        Object.defineProperty(error, 'innerError', {
            get() {
                throw new Error('PRIVATE_GETTER');
            },
        });
        const diagnostic = createLogsDiagnostic(error, 'probeDataPlane');
        expect(diagnostic.messages[0]).toBe('Insufficient access.');
        expect(diagnostic.codes.length).toBeLessThanOrEqual(16);
        expect(diagnostic.messages.length).toBeLessThanOrEqual(8);
        expect(diagnostic.messages.every((message) => message.length <= 512)).toBe(true);
        expect(createLogsDiagnostic({ message: 'SECRET'.repeat(10_000) }, 'client').messages[0]).not.toContain(
            'SECRET',
        );
        let nested: unknown = { code: 'Forbidden' };
        for (let i = 0; i < 100; i++) {
            nested = { innererror: nested };
        }
        expect(classifyLogsFailure(nested).kind).toBe('unknown');
    });

    it.each([511, 512, 513])('bounds a %i-character message using a single ellipsis', (length) => {
        const message = 'A'.repeat(length);
        const diagnostic = createLogsDiagnostic({ message }, 'probeDataPlane');
        expect(diagnostic.messages).toEqual([length > 512 ? `${'A'.repeat(511)}…` : message]);
    });

    it('retains unknown messages and preserves useful text with short resource names', () => {
        expect(
            createLogsDiagnostic(new Error('Unexpected server condition for s.'), 'probeDataPlane', {
                sensitiveValues: ['s'],
            }).messages,
        ).toEqual(['Unexpected server condition for <redacted>.']);
        expect(createLogsDiagnostic('Unfamiliar failure.', 'client').messages).toEqual(['Unfamiliar failure.']);
    });

    it('marks partial failures independently of the availability reason', () => {
        const diagnostic = createLogsDiagnostic({ code: 'InsufficientAccessError' }, 'ingestionBurst', {
            partialFailure: true,
        });

        expect(diagnostic).toMatchObject({ reason: 'rbac', kind: 'partialFailure' });
        const safeError = new LogsFetchError(diagnostic);
        expect(classifyLogsFailure(safeError)).toEqual({ reason: 'rbac', kind: 'partialFailure' });
        expect(safeError).not.toHaveProperty('cause');
        expect(safeError).not.toHaveProperty('diagnostic');
        expect(safeError.message).toBe('Log query failed (ingestionBurst: partialFailure; rbac).');
    });

    it('redacts names with payload delimiters before masking embedded payloads', () => {
        const diagnostic = createLogsDiagnostic(
            { message: 'Insufficient access to private[database] and private{container}.' },
            'crossPartition',
            { sensitiveValues: ['private[database]', 'private{container}'] },
        );
        expect(diagnostic.messages).toEqual(['Insufficient access to <redacted> and <redacted>.']);
    });

    it('removes control characters from unknown diagnostic text', () => {
        const diagnostic = createLogsDiagnostic({ message: 'Server\u001b[31m failed\r\n\u202eSECRET' }, 'client');
        expect(
            diagnostic.messages
                .join('')
                .split('')
                .every((char) => {
                    const code = char.charCodeAt(0);
                    return code >= 32 && code !== 127 && (code < 0x202a || code > 0x202e);
                }),
        ).toBe(true);
    });
});
