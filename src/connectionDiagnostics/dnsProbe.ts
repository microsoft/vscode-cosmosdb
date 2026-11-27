/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { type CheckResult } from './model';
import { withStepTimeout } from './stepTimeout';

const PRIVATE_ADDRESSES = new BlockList();
for (const [address, prefix] of [
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
] as const) {
    PRIVATE_ADDRESSES.addSubnet(address, prefix);
}
PRIVATE_ADDRESSES.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_ADDRESSES.addSubnet('fe80::', 10, 'ipv6');
PRIVATE_ADDRESSES.addAddress('::1', 'ipv6');

export function shouldCheckDnsAfterAccess(checks: readonly CheckResult[]): boolean {
    const access =
        checks.find(({ step, status }) => step === 'query' && status !== 'skipped') ??
        checks.find(({ step }) => step === 'access');
    switch (access?.finding) {
        case 'dnsFailure':
        case 'transportFailure':
        case 'connectionRefused':
        case 'connectionReset':
        case 'connectionTimedOut':
        case 'timedOut':
        case 'firewallPrivateEndpoint':
            return true;
        case 'firewallPublic':
        case 'firewallServiceEndpoint':
        case 'firewallUnknown':
        case 'forbiddenUnknown': {
            const network = checks.find(({ step }) => step === 'accountSettings')?.network;
            // The SDK reached the service. DNS only adds a clue if private routing may be relevant.
            return network !== undefined && (network.publicAccess === 'disabled' || network.privateEndpoints > 0);
        }
        default:
            return false;
    }
}

export async function checkDns(
    url: URL,
    signal: AbortSignal,
    observeAddresses: (addresses: readonly string[]) => void,
): Promise<CheckResult> {
    try {
        const host = url.hostname.replace(/^\[|\]$/g, '');
        const family = isIP(host);
        const addresses = family
            ? [{ address: host, family }]
            : await withStepTimeout(signal, 3_000, () => lookup(host, { all: true }));
        observeAddresses(addresses.map(({ address }) => address));
        const privateCount = addresses.filter(({ address, family }) =>
            PRIVATE_ADDRESSES.check(address, family === 6 ? 'ipv6' : 'ipv4'),
        ).length;
        const finding = !addresses.length
            ? 'unresolvedDns'
            : !privateCount
              ? 'publicDns'
              : privateCount === addresses.length
                ? 'privateDns'
                : 'mixedDns';
        return {
            step: 'dns',
            finding,
            status: finding === 'publicDns' || finding === 'privateDns' ? 'passed' : 'info',
        };
    } catch {
        signal.throwIfAborted();
        return { step: 'dns', finding: 'unresolvedDns', status: 'info' };
    }
}
