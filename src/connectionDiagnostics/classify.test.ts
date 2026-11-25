/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { SilentCosmosAuthenticationError } from '../cosmosdb/SilentCosmosAuthenticationError';
import { classifyAccessError, getHttpFailure } from './classify';
import { renderReport } from './presentation';

describe('Cosmos DB diagnostic findings', () => {
    it.each([
        [{ code: 401 }, 'authentication'],
        [{ code: 407 }, 'proxyAuthentication'],
        [{ code: 408 }, 'requestTimedOut'],
        [{ code: 429 }, 'throttled'],
        [{ code: 503 }, 'serviceUnavailable'],
        [
            { code: 403, message: 'Request originated from client VNET through service endpoint.' },
            'firewallServiceEndpoint',
        ],
        [
            { code: 403, message: 'Request originated from client VNET through private endpoint.' },
            'firewallPrivateEndpoint',
        ],
        [{ code: 403, message: 'Blocked by your Cosmos DB account firewall settings.' }, 'firewallUnknown'],
        [
            { code: 403, message: 'Local Authorization is disabled. Key based authentication is not permitted.' },
            'localAuthDisabled',
        ],
        [
            {
                code: 403,
                message:
                    'Principal does not have required RBAC permissions for Microsoft.DocumentDB/databaseAccounts/readMetadata.',
            },
            'dataRbac',
        ],
        [{ code: 403, substatus: 1014, message: 'Partition key has reached its limit.' }, 'forbiddenUnknown'],
        [{ code: 403, headers: { 'x-ms-substatus': '5300' } }, 'dataPlaneOperationDenied'],
        [{ code: 'ENOTFOUND' }, 'dnsFailure'],
        [{ code: 'REQUEST_SEND_ERROR', cause: { code: 'CERT_HAS_EXPIRED' } }, 'tlsFailure'],
        [{ code: 'ECONNREFUSED' }, 'connectionRefused'],
        [{ code: 'ECONNRESET' }, 'connectionReset'],
        [{ code: 'ETIMEDOUT' }, 'connectionTimedOut'],
        [{ cause: new SilentCosmosAuthenticationError() }, 'tokenUnavailable'],
    ])('classifies %j as %s', (error, finding) => {
        expect(classifyAccessError(error)).toEqual({ finding });
    });

    it('reports bounded codes without interpreting SDK-specific 503 substatuses', () => {
        expect(getHttpFailure({ code: 503, substatus: 20001 })).toEqual({ status: 503, substatus: 20001 });
        expect(classifyAccessError({ code: 503, substatus: 20001 })).toEqual({ finding: 'serviceUnavailable' });
        expect(getHttpFailure({ code: 403, substatus: 'raw service error' })).toEqual({ status: 403 });
    });

    it('exposes the server-observed IPv4 address locally but omits it and the raw error from reports', () => {
        const error = {
            code: 403,
            body: {
                message: 'Request originated from client IP {203.0.113.45} through public internet. secret.example',
            },
        };
        const finding = classifyAccessError(error);
        expect(finding).toEqual({ finding: 'firewallPublic', observedClientIp: '203.0.113.45' });
        const report = renderReport({
            kind: 'azure',
            phase: 'completed',
            checks: [{ step: 'access', status: 'failed', ...finding }],
        });
        expect(report).toContain('IP allowlist');
        expect(report).not.toContain('203.0.113.45');
        expect(report).not.toContain('secret.example');
    });
});
