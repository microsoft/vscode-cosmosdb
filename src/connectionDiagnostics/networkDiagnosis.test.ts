/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { type CheckResult } from './model';
import { diagnoseNetworkDenial, matchesAccountEndpoint } from './networkDiagnosis';

const client = { finding: 'firewallPublic', observedClientIp: '203.0.113.10' } as const;

it('only compares ARM rules against the account or a regional endpoint reported by ARM', () => {
    const account: DatabaseAccountGetResults = {
        documentEndpoint: 'https://account.example.test/',
        readLocations: [{ documentEndpoint: 'https://regional.example.test/' }],
    };
    expect(matchesAccountEndpoint(account, 'https://account.example.test', 'https://regional.example.test')).toBe(true);
    expect(matchesAccountEndpoint(account, 'https://account.example.test', 'https://unknown.example.test')).toBe(false);
    expect(matchesAccountEndpoint(account, 'https://unknown.example.test', 'https://regional.example.test')).toBe(
        false,
    );
});
it.each([
    { rules: ['203.0.113.10'], expected: 'ipRuleMatched' },
    { rules: ['203.0.113.0/24'], expected: 'ipRuleMatched' },
    { rules: ['203.0.113.0/29', '203.0.113.11'], expected: 'ipRuleNotMatched' },
    { rules: ['0.0.0.0'], expected: 'ipRuleNotMatched' },
    { rules: ['203.0.113.0/99'], expected: undefined },
    { rules: [], expected: undefined },
])('compares public-route IPs against explicit address and CIDR rules: $rules', ({ rules, expected }) => {
    expect(
        diagnoseNetworkDenial(client, {
            publicNetworkAccess: 'Enabled',
            ipRules: rules.map((ipAddressOrRange) => ({ ipAddressOrRange })),
        }),
    ).toBe(expected);
});

it('does not suggest IP or VNet changes when public network access is disabled', () => {
    const account: DatabaseAccountGetResults = {
        publicNetworkAccess: 'Disabled',
        ipRules: [{ ipAddressOrRange: '203.0.113.10' }],
        virtualNetworkRules: [{ id: '/example/subnets/allowed' }],
        privateEndpointConnections: [],
    };
    for (const finding of ['firewallPublic', 'firewallServiceEndpoint', 'firewallUnknown'] as const) {
        expect(diagnoseNetworkDenial({ ...client, finding }, account)).toBe('publicAccessDisabledNoPrivateEndpoint');
    }
    expect(diagnoseNetworkDenial(client, { ...account, privateEndpointConnections: [{}] })).toBe(
        'publicAccessDisabled',
    );
    expect(diagnoseNetworkDenial({ finding: 'forbiddenUnknown' }, account)).toBeUndefined();
    expect(diagnoseNetworkDenial({ finding: 'dataRbac' }, account)).toBeUndefined();
});

it.each([
    { status: 'Pending', expected: 'noApprovedPrivateEndpoint' },
    { status: 'Approved', expected: undefined },
    { status: undefined, expected: undefined },
])('checks Private Link approval without inferring client routing: $status', ({ status, expected }) => {
    expect(
        diagnoseNetworkDenial(
            { finding: 'firewallPrivateEndpoint' },
            {
                publicNetworkAccess: 'Disabled',
                privateEndpointConnections: [{ privateLinkServiceConnectionState: { status } }],
            },
        ),
    ).toBe(expected);
});

it('separates service endpoint rules and perimeter mode from explicit IP rules', () => {
    const service: Pick<CheckResult, 'finding'> = { finding: 'firewallServiceEndpoint' };
    const account: DatabaseAccountGetResults = {
        publicNetworkAccess: 'Enabled',
        isVirtualNetworkFilterEnabled: true,
        virtualNetworkRules: [],
    };
    expect(diagnoseNetworkDenial(service, account)).toBe('noAllowedSubnets');
    expect(diagnoseNetworkDenial({ finding: 'firewallUnknown' }, account)).toBeUndefined();
    expect(diagnoseNetworkDenial(service, { ...account, virtualNetworkRules: [{ id: '/other' }] })).toBeUndefined();
    expect(diagnoseNetworkDenial(client, { ...account, publicNetworkAccess: 'SecuredByPerimeter' })).toBe(
        'perimeterAccess',
    );
});
