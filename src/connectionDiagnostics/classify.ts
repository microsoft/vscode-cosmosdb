/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isIP } from 'node:net';
import { SilentCosmosAuthenticationError } from '../cosmosdb/SilentCosmosAuthenticationError';
import { type CheckResult } from './model';

const dnsErrors = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENODATA']);
const tlsErrors = new Set([
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_GET_ISSUER_CERT',
    'CERT_NOT_YET_VALID',
]);
const transportErrors = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE']);

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function classifyAccessError(error: unknown): Pick<CheckResult, 'finding' | 'observedClientIp'> {
    const outer = record(error);
    const status = String(outer.statusCode ?? outer.code ?? '');
    if (status === '401') return { finding: 'authentication' };
    if (status === '407') return { finding: 'proxyAuthentication' };
    if (status === '429') return { finding: 'throttled' };
    if (/^5\d{2}$/.test(status)) return { finding: 'serviceUnavailable' };

    if (status === '403') {
        const substatus = Number(outer.substatus ?? record(outer.headers)['x-ms-substatus']);
        if (substatus === 5300) return { finding: 'dataPlaneOperationDenied' };
        const message = record(outer.body).message ?? outer.message;
        if (typeof message !== 'string') return { finding: 'forbiddenUnknown' };
        const ip = /request originated from client IP\s+[\s{]*([0-9.]+)[\s}]*\s+through public internet/i.exec(
            message,
        )?.[1];
        if (ip && isIP(ip) === 4) return { finding: 'firewallPublic', observedClientIp: ip };
        if (/request originated from client IP[^\r\n]*through public internet/i.test(message)) {
            return { finding: 'firewallPublic' };
        }
        if (/request originated from client VNET through service endpoint/i.test(message)) {
            return { finding: 'firewallServiceEndpoint' };
        }
        if (/request originated from client VNET through private endpoint/i.test(message)) {
            return { finding: 'firewallPrivateEndpoint' };
        }
        if (/blocked by (?:your |the )?(?:[\w ]*account['’]s |(?:cosmos db account )?)firewall/i.test(message)) {
            return { finding: 'firewallUnknown' };
        }
        if (
            /local auth(?:entication)? (?:is |has been )?disabled|key based authentication is not permitted/i.test(
                message,
            )
        ) {
            return { finding: 'localAuthDisabled' };
        }
        if (
            /does not have required RBAC permissions|Microsoft\.DocumentDB\/databaseAccounts\/readMetadata/i.test(
                message,
            )
        ) {
            return { finding: 'dataRbac' };
        }
        return { finding: 'forbiddenUnknown' };
    }

    for (let current = outer, depth = 0; depth < 4; current = record(current.cause), depth++) {
        if (current instanceof SilentCosmosAuthenticationError) return { finding: 'authentication' };
        const code = current.code;
        if (typeof code !== 'string') continue;
        if (dnsErrors.has(code)) return { finding: 'dnsFailure' };
        if (tlsErrors.has(code) || /^(ERR_TLS_|ERR_SSL_)/.test(code)) return { finding: 'tlsFailure' };
        if (transportErrors.has(code)) return { finding: 'transportFailure' };
    }
    return { finding: 'unexpected' };
}
