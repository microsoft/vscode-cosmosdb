/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type CheckResult, type DiagnosticsState, type Finding, type Step } from './model';

export function stepLabel(step: Step): string {
    return {
        target: l10n.t('Connection endpoint'),
        accountSettings: l10n.t('Azure account settings'),
        access: l10n.t('Cosmos DB access'),
        dns: l10n.t('Extension host DNS'),
    }[step];
}

export function phaseLabel(state: DiagnosticsState): string {
    if (state.phase === 'cancelled') return l10n.t('Connection diagnostics cancelled.');
    if (state.phase === 'running') return l10n.t('Connection diagnostics running.');
    return state.checks.some((check) => check.finding === 'connected')
        ? l10n.t('Connected to Cosmos DB.')
        : l10n.t('Could not verify access to Cosmos DB.');
}

export function checkText(check: CheckResult, kind: DiagnosticsState['kind']): string {
    const descriptions: Record<Finding, string> = {
        endpointReady: l10n.t('The connection endpoint is valid.'),
        invalidEndpoint: l10n.t(
            'Could not resolve a valid endpoint. Check the saved connection or your Azure account access.',
        ),
        settingsRead: l10n.t('Account settings were read from Azure Resource Manager.'),
        settingsUnavailable: l10n.t(
            'Could not read Azure account settings. This does not establish whether the data endpoint is reachable.',
        ),
        settingsNotApplicable:
            kind === 'emulator'
                ? l10n.t('Azure network rules do not apply to the local emulator.')
                : l10n.t('Azure network settings cannot be read from a connection string alone.'),
        connected: l10n.t('The SDK read database metadata. No documents were read.'),
        missingCredentials: l10n.t(
            'No account key was available. Check the saved connection or your permission to retrieve an Azure account key.',
        ),
        authentication: l10n.t(
            'The selected credential was rejected or a token could not be acquired. Verify the key or the selected identity and sign in again if needed.',
        ),
        localAuthDisabled: l10n.t(
            'Account-key authentication is disabled. Use Microsoft Entra ID or managed identity with the appropriate Cosmos DB data permissions.',
        ),
        dataRbac: l10n.t(
            'The identity lacks Cosmos DB data-plane permissions. Check its Cosmos DB data role and scope, including the readMetadata action. Azure management roles alone are not sufficient.',
        ),
        dataPlaneOperationDenied: l10n.t(
            'Cosmos DB reported an operation that cannot be authorized by an Entra token on the data plane. This is not an IP firewall diagnosis.',
        ),
        firewallPublic: l10n.t(
            'Cosmos DB blocked the public route. Check public network access and the IP allowlist for the outgoing address seen by Cosmos DB; a proxy or NAT can change this address. If you expected Private Link, check private DNS and routing first.',
        ),
        firewallServiceEndpoint: l10n.t(
            'Cosmos DB blocked the service endpoint route. Check the allowed virtual networks and subnets and the Microsoft.AzureCosmosDB service endpoint.',
        ),
        firewallPrivateEndpoint: l10n.t(
            'Cosmos DB blocked the private endpoint route. Check the private endpoint approval, account association, private DNS, and routing from the extension host.',
        ),
        firewallUnknown: l10n.t(
            'Cosmos DB reported a firewall block. Check public access, IP rules, virtual network rules, and private endpoint configuration for the route you expected.',
        ),
        forbiddenUnknown: l10n.t(
            'The request was forbidden, but the response did not identify a cause. Check network rules and Cosmos DB data-plane permissions separately.',
        ),
        proxyAuthentication: l10n.t('The HTTP proxy requires authentication. Check your VS Code proxy configuration.'),
        dnsFailure: l10n.t(
            'A hostname could not be resolved along the SDK request path. Check DNS, VPN, and proxy settings.',
        ),
        tlsFailure:
            kind === 'emulator'
                ? l10n.t('TLS negotiation failed. Verify the emulator protocol, port, and certificate configuration.')
                : l10n.t('TLS negotiation failed. Check the certificate trust chain and any intercepting proxy.'),
        transportFailure:
            kind === 'emulator'
                ? l10n.t(
                      'The emulator could not be reached. Verify that it is running and that the configured port is accessible from the extension host.',
                  )
                : l10n.t(
                      'The SDK could not establish or keep a connection. Check your network, VPN, and proxy settings.',
                  ),
        throttled: l10n.t('Cosmos DB throttled the request. Try again after the account has capacity.'),
        serviceUnavailable: l10n.t(
            'The request received a server error. Check Azure service health or proxy availability and retry.',
        ),
        unexpected: l10n.t('The check did not return a recognized result.'),
        timedOut:
            kind === 'emulator'
                ? l10n.t(
                      'The emulator did not respond in time. Verify that it is running and that its port is reachable from the extension host.',
                  )
                : l10n.t('The SDK request timed out. Check the extension host network, VPN, and proxy.'),
        privateDns: l10n.t(
            'The extension host resolved private or local addresses. This does not verify the proxy route or Private Link connection.',
        ),
        publicDns: l10n.t(
            'The extension host resolved public addresses. If you expected a direct Private Link connection, check private DNS. A proxy may resolve this hostname differently.',
        ),
        mixedDns: l10n.t(
            'The extension host resolved both public and private addresses. Check DNS if you expected to use Private Link.',
        ),
        unresolvedDns: l10n.t(
            'Local name resolution was inconclusive. A proxy may resolve the hostname independently.',
        ),
    };
    const auth = {
        key: l10n.t('Account key'),
        entra: l10n.t('Microsoft Entra ID'),
        identity: l10n.t('Managed identity'),
    };
    const parts = [descriptions[check.finding]];
    if (check.auth) parts.push(l10n.t('Authentication method: {0}', auth[check.auth]));
    if (check.network) {
        const network = check.network;
        const publicAccess = {
            enabled: l10n.t('Enabled'),
            disabled: l10n.t('Disabled'),
            securedByPerimeter: l10n.t('Secured by network security perimeter'),
            unknown: l10n.t('Unknown'),
        };
        parts.push(l10n.t('Public network access: {0}', publicAccess[network.publicAccess]));
        parts.push(
            l10n.t(
                'IP rules: {0}; virtual network rules: {1}; private endpoint connections: {2}.',
                network.ipRules,
                network.vnetRules,
                network.privateEndpoints,
            ),
        );
        if (network.vnetFilterEnabled) parts.push(l10n.t('Virtual network filtering is enabled.'));
        if (network.localAuthDisabled) parts.push(l10n.t('Account-key authentication is disabled.'));
    }
    return parts.join(' ');
}

export function statusLabel(status: CheckResult['status']): string {
    return {
        passed: l10n.t('Passed'),
        failed: l10n.t('Failed'),
        info: l10n.t('Information'),
        skipped: l10n.t('Skipped'),
    }[status];
}

export function renderReport(state: DiagnosticsState): string {
    return [
        l10n.t('Cosmos DB connection diagnostics'),
        phaseLabel(state),
        ...state.checks.map(
            (check) => `${stepLabel(check.step)} (${statusLabel(check.status)}) — ${checkText(check, state.kind)}`,
        ),
    ].join('\n');
}
