/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { AuthenticationMethod } from './AuthenticationMethod';
import { maskConnectionTelemetry } from './maskConnectionTelemetry';
import { type NoSqlQueryConnection } from './NoSqlQueryConnection';

vi.mock('../extensionVariables', () => ({ ext: {} }));

const connection: NoSqlQueryConnection = {
    endpoint: 'https://private-account.documents.azure.com',
    databaseId: 'private-database',
    containerId: 'private-container',
    credentials: [],
    isEmulator: false,
};

describe('maskConnectionTelemetry', () => {
    it('masks keys and client IDs while preserving tenant OII and error handling', () => {
        const context = {
            valuesToMask: ['existing-mask'],
            telemetry: { properties: { sessionId: 'random-session', tenantId: 'first-tenant' }, measurements: {} },
            errorHandling: { rethrow: true, suppressDisplay: false, suppressReportIssue: false },
        };
        const original = structuredClone(context);

        maskConnectionTelemetry(context, {
            ...connection,
            credentials: [
                { type: AuthenticationMethod.accountKey, key: 'first-key' },
                { type: AuthenticationMethod.entraId, tenantId: 'first-tenant' },
                { type: AuthenticationMethod.managedIdentity, clientId: 'first-client' },
                { type: AuthenticationMethod.accountKey, key: 'second-key' },
                { type: AuthenticationMethod.entraId, tenantId: 'second-tenant' },
                { type: AuthenticationMethod.managedIdentity, clientId: 'second-client' },
            ],
        });

        expect(context).toEqual({
            ...original,
            valuesToMask: [
                'existing-mask',
                'first-key',
                'first-client',
                'second-key',
                'second-client',
                connection.endpoint,
                connection.databaseId,
                connection.containerId,
            ],
        });
    });

    it('handles connections without credentials', () => {
        const context = { valuesToMask: [] };

        maskConnectionTelemetry(context, connection);

        expect(context.valuesToMask).toEqual([connection.endpoint, connection.databaseId, connection.containerId]);
    });

    it('excludes undefined, empty, and whitespace-only values but preserves nonblank values verbatim', () => {
        const context = { valuesToMask: [] };

        maskConnectionTelemetry(context, {
            ...connection,
            endpoint: '',
            databaseId: ' \t ',
            containerId: ' container ',
            credentials: [
                { type: AuthenticationMethod.accountKey, key: '' },
                { type: AuthenticationMethod.accountKey, key: ' \t ' },
                { type: AuthenticationMethod.entraId, tenantId: undefined },
                { type: AuthenticationMethod.entraId, tenantId: '' },
                { type: AuthenticationMethod.entraId, tenantId: ' \t ' },
                { type: AuthenticationMethod.managedIdentity, clientId: undefined },
                { type: AuthenticationMethod.managedIdentity, clientId: '' },
                { type: AuthenticationMethod.managedIdentity, clientId: ' \t ' },
                { type: AuthenticationMethod.accountKey, key: ' key ' },
                { type: AuthenticationMethod.entraId, tenantId: ' tenant ' },
                { type: AuthenticationMethod.managedIdentity, clientId: ' client ' },
            ],
        });

        expect(context.valuesToMask).toEqual([' key ', ' client ', ' container ']);
    });
});
