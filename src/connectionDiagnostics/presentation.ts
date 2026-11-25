/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { checkHelpTopics, diagnosticsHelpUrls, helpLabel } from './help';
import { type CheckResult, type DiagnosticsState, type Finding, type Step } from './model';

export function stepLabel(step: Step): string {
    return {
        target: l10n.t('Connection endpoint'),
        accountSettings: l10n.t('Azure account settings (control plane)'),
        access: l10n.t('Cosmos DB data-plane access'),
        query: l10n.t('Selected container query'),
        dns: l10n.t('Server address (DNS)'),
    }[step];
}

export function phaseLabel(state: DiagnosticsState): string {
    if (state.phase === 'cancelled') return l10n.t('Connection diagnostics cancelled.');
    if (state.phase === 'running') return l10n.t('Connection diagnostics running.');
    if (state.checks.some((check) => check.finding === 'dataRbac')) {
        return l10n.t('Cosmos DB data role required.');
    }
    if (state.scope === 'container') {
        return state.checks.some((check) => check.finding === 'querySucceeded')
            ? l10n.t('Query access to the selected container verified.')
            : l10n.t('Could not verify query access to the selected container.');
    }
    if (state.checks.some((check) => check.finding === 'apiProbeUnavailable')) {
        return l10n.t('Diagnostics complete. Data-plane access was not tested.');
    }
    return state.checks.some((check) => check.finding === 'connected')
        ? l10n.t('Cosmos DB data-plane access verified.')
        : l10n.t('Could not verify Cosmos DB data-plane access.');
}

function authText(method: NonNullable<CheckResult['auth']>): string {
    const label = {
        key: l10n.t('Account key'),
        entra: l10n.t('Microsoft Entra ID'),
        identity: l10n.t('Managed identity'),
    }[method];
    return l10n.t('Authentication method: {0}', label);
}

function publicAccessText(network: NonNullable<CheckResult['network']>): string {
    const label = {
        enabled: l10n.t('Enabled'),
        disabled: l10n.t('Disabled'),
        securedByPerimeter: l10n.t('Secured by network security perimeter'),
        unknown: l10n.t('Unknown'),
    }[network.publicAccess];
    return l10n.t('Public network access: {0}', label);
}

export function checkEvidence(check: CheckResult): string | undefined {
    if (check.network) return publicAccessText(check.network);
    if (check.auth) return authText(check.auth);
    return check.status === 'skipped' ? statusLabel(check.status) : undefined;
}

export function checkText(
    check: CheckResult,
    kind: DiagnosticsState['kind'],
    { omitRowEvidence = false }: { omitRowEvidence?: boolean } = {},
): string {
    const descriptions: Record<Finding, string> = {
        endpointReady: l10n.t('The connection endpoint is valid.'),
        invalidEndpoint: l10n.t(
            'Could not resolve a valid endpoint. Check the saved connection or your Azure account access.',
        ),
        settingsRead: l10n.t(
            'Control-plane access was verified through Azure Resource Manager. It does not grant or verify data-plane access.',
        ),
        settingsUnavailable: l10n.t(
            'Could not read Azure account settings. This does not establish whether the data endpoint is reachable.',
        ),
        settingsNotApplicable:
            kind === 'emulator'
                ? l10n.t('Azure network rules do not apply to the local emulator.')
                : l10n.t('Azure network settings cannot be read from a connection string alone.'),
        apiProbeUnavailable: l10n.t(
            'The data-plane probe is only available for NoSQL connections. Network settings and DNS do not verify access to this API.',
        ),
        connected: l10n.t('The SDK read database metadata. No documents were read.'),
        accountMetadataRead: l10n.t(
            'The SDK read account metadata. This does not verify permission to query the container.',
        ),
        querySucceeded: l10n.t('The SDK ran a read-only query that returns no document contents.'),
        queryNotRun: l10n.t('The query was not attempted because the account metadata check did not pass.'),
        missingCredentials: l10n.t(
            'No usable credentials were available. Check the configured authentication method or the saved connection.',
        ),
        authentication: l10n.t('The service rejected the credential. Verify the account key or selected identity.'),
        tokenUnavailable: l10n.t(
            'No Microsoft Entra token could be acquired without prompting. Sign in or check the configured managed identity, then re-run diagnostics.',
        ),
        localAuthDisabled: l10n.t(
            'Account-key authentication is disabled. Use Microsoft Entra ID or managed identity with the appropriate Cosmos DB data permissions.',
        ),
        dataRbac:
            check.step === 'query'
                ? l10n.t(
                      'The identity lacks the required Cosmos DB data permissions for this query. Check the data role and its scope for this container.',
                  )
                : l10n.t(
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
            'Cosmos DB reported a firewall block without identifying the route. Check public network access and the IP rules for your outgoing address, or the virtual network and private endpoint settings if you expected a private route. This result does not tell you whether your identity has a data role.',
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
        connectionRefused:
            kind === 'emulator'
                ? l10n.t(
                      'The emulator connection was refused. Check that the emulator is running and that its gateway port is published and reachable from the extension host.',
                  )
                : l10n.t(
                      'The connection was refused on the SDK request path. Check the endpoint, port, and configured proxy.',
                  ),
        connectionReset: l10n.t(
            'The connection was reset on the SDK request path. Check the gateway protocol and any proxy or network filter.',
        ),
        connectionTimedOut: l10n.t(
            'The connection timed out on the SDK request path. Check routing, port forwarding, and any proxy from the extension host.',
        ),
        requestTimedOut: l10n.t(
            'An HTTP endpoint returned a request timeout. The SDK reached an HTTP server; this is not a DNS failure.',
        ),
        containerUnavailable: l10n.t(
            'An SDK request during the query check returned Not Found. Verify the selected database and container for this connection.',
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
            'The extension host resolved the hostname to public IP addresses. This is expected for public access. DNS does not show which route the SDK used or whether Cosmos DB permits the connection. A proxy can resolve the hostname separately.',
        ),
        mixedDns: l10n.t(
            'The extension host resolved both public and private addresses. Check DNS if you expected to use Private Link.',
        ),
        unresolvedDns: l10n.t(
            'Local name resolution was inconclusive. A proxy may resolve the hostname independently.',
        ),
    };
    const rowEvidence = omitRowEvidence ? checkEvidence(check) : undefined;
    const parts = [descriptions[check.finding]];
    if (check.failureStage) {
        const stage = {
            credentials: l10n.t('Credential acquisition'),
            accountMetadata: l10n.t('Account metadata'),
            listDatabases: l10n.t('Database listing'),
            containerMetadata: l10n.t('Container metadata or routing'),
            query: l10n.t('Container query'),
        }[check.failureStage];
        parts.push(l10n.t('Failed at: {0}.', stage));
    }
    if (check.http) {
        parts.push(
            check.http.substatus === undefined
                ? l10n.t('HTTP status: {0}.', check.http.status)
                : l10n.t('HTTP status: {0}; Cosmos DB substatus: {1}.', check.http.status, check.http.substatus),
        );
    }
    if (check.auth) {
        const auth = authText(check.auth);
        if (auth !== rowEvidence) parts.push(auth);
    }
    if (check.network) {
        const network = check.network;
        if (!omitRowEvidence) parts.push(publicAccessText(network));
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
    const help = [...new Set(state.checks.flatMap((check) => checkHelpTopics(check, state.kind)))];
    return [
        `# ${l10n.t('Cosmos DB connection diagnostics')}`,
        '',
        phaseLabel(state),
        '',
        ...state.checks.map(
            (check) => `- ${stepLabel(check.step)} (${statusLabel(check.status)}) — ${checkText(check, state.kind)}`,
        ),
        ...(help.length
            ? [
                  '',
                  `## ${l10n.t('Troubleshooting documentation')}`,
                  '',
                  ...help.map((topic) => `- [${helpLabel(topic)}](${diagnosticsHelpUrls[topic]})`),
              ]
            : []),
        ...(state.trace
            ? [
                  '',
                  `## ${l10n.t('Check log')}`,
                  '',
                  l10n.t('Run ID: {0}', state.trace.runId),
                  '',
                  '```text',
                  ...state.trace.lines,
                  '```',
              ]
            : []),
    ].join('\n');
}

export function renderJsonReport(state: DiagnosticsState): string {
    return JSON.stringify(
        {
            runId: state.trace?.runId,
            targetKind: state.kind,
            scope: state.scope,
            phase: state.phase,
            checks: state.checks.map(({ step, finding, status, auth, network, failureStage, http }) => ({
                step,
                finding,
                status,
                auth,
                failureStage,
                http: http && { status: http.status, substatus: http.substatus },
                durationMs: state.trace?.checkDurations?.[step],
                network: network && {
                    publicAccess: network.publicAccess,
                    ipRules: network.ipRules,
                    vnetFilterEnabled: network.vnetFilterEnabled,
                    vnetRules: network.vnetRules,
                    privateEndpoints: network.privateEndpoints,
                    localAuthDisabled: network.localAuthDisabled,
                },
            })),
            log: state.trace?.lines,
        },
        undefined,
        2,
    );
}
