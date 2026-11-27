/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BlockList, isIP } from 'node:net';
import { type CheckResult, type NetworkDiagnosis } from './model';
import { type DiagnosticsArmAccount } from './target';

type NetworkAccount = DiagnosticsArmAccount['databaseAccount'];

export function matchesAccountEndpoint(
    account: NetworkAccount,
    configuredOrigin: string,
    requestOrigin = configuredOrigin,
): boolean {
    const endpoints = [
        account.documentEndpoint,
        ...[...(account.readLocations ?? []), ...(account.writeLocations ?? [])].map(
            ({ documentEndpoint }) => documentEndpoint,
        ),
    ];
    const origins = endpoints.map((endpoint) => (endpoint ? URL.parse(endpoint)?.origin : undefined));
    return origins.includes(configuredOrigin) && origins.includes(requestOrigin);
}

export function diagnoseNetworkDenial(
    { finding, observedClientIp }: Pick<CheckResult, 'finding' | 'observedClientIp'>,
    account: NetworkAccount,
): NetworkDiagnosis | undefined {
    if (
        finding !== 'firewallPublic' &&
        finding !== 'firewallServiceEndpoint' &&
        finding !== 'firewallPrivateEndpoint' &&
        finding !== 'firewallUnknown'
    )
        return undefined;

    const endpoints = account.privateEndpointConnections ?? [];
    if (finding !== 'firewallPrivateEndpoint' && account.publicNetworkAccess === 'Disabled') {
        return endpoints.length ? 'publicAccessDisabled' : 'publicAccessDisabledNoPrivateEndpoint';
    }
    if (finding === 'firewallPrivateEndpoint' && !endpoints.length) return 'noPrivateEndpoint';
    if (
        finding === 'firewallPrivateEndpoint' &&
        endpoints.every(({ privateLinkServiceConnectionState }) =>
            ['Pending', 'Rejected', 'Disconnected'].some(
                (status) => status === privateLinkServiceConnectionState?.status,
            ),
        )
    )
        return 'noApprovedPrivateEndpoint';
    if (account.publicNetworkAccess === 'SecuredByPerimeter') return 'perimeterAccess';
    if (account.publicNetworkAccess !== 'Enabled') return undefined;

    if (
        finding === 'firewallServiceEndpoint' &&
        account.isVirtualNetworkFilterEnabled === true &&
        !account.virtualNetworkRules?.length
    )
        return 'noAllowedSubnets';
    if (finding === 'firewallPublic' && observedClientIp && account.ipRules?.length) {
        return compareIpRules(observedClientIp, account.ipRules);
    }
    return undefined;
}

function compareIpRules(ip: string, rules: NonNullable<NetworkAccount['ipRules']>): NetworkDiagnosis | undefined {
    if (isIP(ip) !== 4) return undefined;
    const addresses = new BlockList();
    let invalidRule = false;
    for (const { ipAddressOrRange } of rules) {
        // 0.0.0.0 is Cosmos DB's Azure datacenter exception, not an ordinary client IP rule.
        if (ipAddressOrRange === '0.0.0.0') continue;
        const [address, bits, ...rest] = ipAddressOrRange?.split('/') ?? [];
        if (!address || isIP(address) !== 4 || rest.length || (bits !== undefined && !/^\d{1,2}$/.test(bits))) {
            invalidRule = true;
        } else if (bits === undefined) {
            addresses.addAddress(address);
        } else if (Number(bits) <= 32) {
            addresses.addSubnet(address, Number(bits));
        } else {
            invalidRule = true;
        }
    }
    if (addresses.check(ip)) return 'ipRuleMatched';
    return invalidRule ? undefined : 'ipRuleNotMatched';
}
