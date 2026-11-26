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
const transportErrors = new Set(['ENETUNREACH', 'EHOSTUNREACH', 'EPIPE']);

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function accessErrorMessage(error: unknown): unknown {
    const outer = record(error);
    return record(outer.body).message ?? outer.message;
}

export function matchesDeniedPrincipal(error: unknown, principalId: string): boolean {
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(principalId)) return false;
    const message = accessErrorMessage(error);
    return (
        typeof message === 'string' &&
        /does not have required RBAC permissions/i.test(message) &&
        message.toLowerCase().includes(`[${principalId.toLowerCase()}]`)
    );
}

function numericCode(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    return typeof value === 'string' && /^\d{1,5}$/.test(value) ? Number(value) : undefined;
}

export function getHttpFailure(error: unknown): CheckResult['http'] {
    const outer = record(error);
    const status = numericCode(outer.statusCode ?? outer.code);
    if (status === undefined || status < 400 || status > 599) return undefined;
    const substatus = numericCode(outer.substatus ?? record(outer.headers)['x-ms-substatus']);
    return substatus !== undefined && substatus >= 0 && substatus <= 99999 ? { status, substatus } : { status };
}

export function classifyAccessError(
    error: unknown,
    http = getHttpFailure(error),
): Pick<CheckResult, 'finding' | 'observedClientIp'> {
    const outer = record(error);
    const status = http?.status;
    if (status === 401) return { finding: 'authentication' };
    if (status === 407) return { finding: 'proxyAuthentication' };
    if (status === 408) return { finding: 'requestTimedOut' };
    if (status === 429) return { finding: 'throttled' };
    if (status !== undefined && status >= 500) return { finding: 'serviceUnavailable' };

    if (status === 403) {
        if (http?.substatus === 5300) return { finding: 'dataPlaneOperationDenied' };
        const message = accessErrorMessage(error);
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
            /local auth(?:entication|orization)? (?:is |has been )?disabled|key based authentication is not permitted/i.test(
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
        if (current instanceof SilentCosmosAuthenticationError) return { finding: 'tokenUnavailable' };
        const code = current.code;
        if (typeof code !== 'string') continue;
        if (dnsErrors.has(code)) return { finding: 'dnsFailure' };
        if (tlsErrors.has(code) || /^(ERR_TLS_|ERR_SSL_)/.test(code)) return { finding: 'tlsFailure' };
        if (code === 'ECONNREFUSED') return { finding: 'connectionRefused' };
        if (code === 'ECONNRESET') return { finding: 'connectionReset' };
        if (code === 'ETIMEDOUT') return { finding: 'connectionTimedOut' };
        if (transportErrors.has(code)) return { finding: 'transportFailure' };
    }
    return { finding: 'unexpected' };
}
