/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { checkHelpTopics, diagnosticsHelpUrls, helpLabel } from './help';
import {
    type ActiveStep,
    type CheckResult,
    type DiagnosticsState,
    type Finding,
    getPrimaryDataCheck,
    isOverviewStep,
    type OverviewStep,
} from './model';

export function stepLabel(step: ActiveStep): string {
    return {
        target: l10n.t('Connection endpoint'),
        accountSettings: l10n.t('Azure account settings (control plane)'),
        access: l10n.t('Cosmos DB data-plane access'),
        query: l10n.t('Selected container query'),
        dns: l10n.t('Server address (DNS)'),
        accountOverview: l10n.t('Account Overview access'),
        metrics: l10n.t('Azure Monitor metrics'),
        alerts: l10n.t('Azure Monitor alerts'),
        advisor: l10n.t('Azure Advisor recommendations'),
        requestLogs: l10n.t('Log Analytics request logs'),
        queryLogs: l10n.t('Log Analytics query runtime logs'),
    }[step];
}

export function phaseLabel(state: DiagnosticsState): string {
    if (state.phase === 'cancelled') return l10n.t('Connection diagnostics cancelled.');
    if (state.phase === 'running') return l10n.t('Connection diagnostics running.');
    const result = getPrimaryDataCheck(state);
    if (result?.finding === 'querySucceeded') {
        return l10n.t('Query access to the selected container verified.');
    }
    if (result?.finding === 'dataRbac') {
        return l10n.t('Cosmos DB data role required.');
    }
    if (state.scope === 'container') {
        return l10n.t('Could not verify query access to the selected container.');
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

function overviewReadText(step: OverviewStep): string {
    switch (step) {
        case 'metrics':
            return l10n.t(
                'Azure Monitor accepted the request to read the {0} metric for this account.',
                'TotalRequests',
            );
        case 'alerts':
            return l10n.t('Azure Monitor accepted the request to list fired alerts for this account.');
        case 'advisor':
            return l10n.t('Azure Advisor accepted the request to list recommendations for this subscription.');
        case 'requestLogs':
        case 'queryLogs':
            return l10n.t(
                'The Log Analytics query against the {0} table succeeded. The check did not request log entries.',
                step === 'requestLogs' ? 'CDBDataPlaneRequests' : 'CDBQueryRuntimeStatistics',
            );
    }
}

function overviewPermissionHint(step: OverviewStep): string {
    if (step === 'requestLogs' || step === 'queryLogs') {
        return l10n.t(
            'Check effective log-query permissions and the workspace access mode. Log Analytics Reader is one way to grant this access.',
        );
    }
    if (step === 'advisor') {
        return l10n.t('Check Azure Advisor read access at subscription scope, for example through the Reader role.');
    }
    return l10n.t(
        'Check Azure Monitor read permissions and their scope, for example through the Monitoring Reader role.',
    );
}

function networkDiagnosisText(diagnosis: NonNullable<CheckResult['networkDiagnosis']>): string {
    switch (diagnosis) {
        case 'publicAccessDisabled':
            return l10n.t(
                'Public network access is disabled. IP and VNet service endpoint rules do not allow access in this mode. Verify the Private Link configuration.',
            );
        case 'publicAccessDisabledNoPrivateEndpoint':
            return l10n.t(
                'Public network access is disabled, and Azure reported no private endpoint connections. Adding an IP or VNet service endpoint rule will not open access in this mode. Check the intended Private Link configuration.',
            );
        case 'ipRuleMatched':
            return l10n.t(
                'An IP rule covers the address reported by Cosmos DB. Do not add it again. Check for recent rule changes or other network restrictions.',
            );
        case 'ipRuleNotMatched':
            return l10n.t(
                'No explicit IP rule covers the address reported by Cosmos DB. If public access is intended, ask the account administrator to review the allowlist.',
            );
        case 'noAllowedSubnets':
            return l10n.t(
                'Virtual network filtering is enabled, but no subnets are listed. Verify the source subnet and its Microsoft.AzureCosmosDB service endpoint before changing any rules.',
            );
        case 'noPrivateEndpoint':
            return l10n.t(
                'Azure reported no private endpoint connections for this account. Verify the account associated with the private endpoint.',
            );
        case 'noApprovedPrivateEndpoint':
            return l10n.t(
                'None of the listed private endpoint connections is approved. Check the approval status in Azure.',
            );
        case 'perimeterAccess':
            return l10n.t(
                'Public access is controlled by a Network Security Perimeter. Ask the administrator to check its access rules for this account.',
            );
    }
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
        querySucceeded: l10n.t('The SDK ran a read-only query that returns no document contents.'),
        queryNotRun: l10n.t('The query was not attempted because the data-plane access check did not pass.'),
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
                : check.failureStage === 'listDatabases'
                  ? l10n.t(
                        'The identity cannot list databases at account scope. This does not determine permissions on an individual container.',
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
                ? l10n.t(
                      'TLS negotiation failed. Check the emulator protocol and port, and make sure the VS Code extension host trusts the emulator certificate.',
                  )
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
        overviewRead: isOverviewStep(check.step)
            ? overviewReadText(check.step)
            : l10n.t('The check did not return a recognized result.'),
        overviewDenied: l10n.t('Azure denied the read request for the signed-in identity.'),
        overviewAuthentication: l10n.t(
            'Azure rejected the authentication for this request. Sign in to Azure and try again.',
        ),
        overviewLogsMissing: l10n.t(
            'Log Analytics could not resolve the required table. Check resource-specific diagnostic log collection and wait for data to arrive.',
        ),
        overviewUnavailable: l10n.t(
            'Could not verify read access. Retry, and check Azure sign-in or service availability if this persists.',
        ),
        overviewTimedOut: l10n.t('The Azure read probe timed out. This does not establish whether access is allowed.'),
    };
    const rowEvidence = omitRowEvidence ? checkEvidence(check) : undefined;
    const description =
        check.networkDiagnosis && check.finding === 'firewallUnknown'
            ? l10n.t(
                  'Cosmos DB reported a firewall block without identifying the route. This result does not tell you whether your identity has a data role.',
              )
            : descriptions[check.finding];
    const parts = [description];
    if (check.networkDiagnosis) parts.push(networkDiagnosisText(check.networkDiagnosis));
    if (check.finding === 'overviewDenied' && isOverviewStep(check.step))
        parts.push(overviewPermissionHint(check.step));
    if (check.finding === 'overviewLogsMissing') {
        if (check.step === 'requestLogs') parts.push(l10n.t('Required diagnostic category: DataPlaneRequests.'));
        if (check.step === 'queryLogs') parts.push(l10n.t('Required diagnostic category: QueryRuntimeStatistics.'));
    }
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

export function renderReport(state: DiagnosticsState, localTrace: readonly string[] = []): string {
    const help = [...new Set(state.checks.flatMap((check) => checkHelpTopics(check, state.kind)))];
    const overview = state.checks.filter(({ step }) => isOverviewStep(step));
    const row = (check: CheckResult) =>
        `- ${stepLabel(check.step)} (${statusLabel(check.status)}) — ${checkText(check, state.kind)}`;
    return [
        `# ${l10n.t('Cosmos DB connection diagnostics')}`,
        '',
        ...(localTrace.length
            ? [
                  l10n.t(
                      'This local report contains network addresses and may contain Azure activity IDs. Use Share report for a redacted copy.',
                  ),
                  '',
              ]
            : []),
        phaseLabel(state),
        '',
        ...state.checks.filter(({ step }) => !isOverviewStep(step)).map(row),
        ...(overview.length ? ['', `## ${stepLabel('accountOverview')}`, '', ...overview.map(row)] : []),
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
                  `## ${localTrace.length ? l10n.t('Local check log') : l10n.t('Check log')}`,
                  '',
                  l10n.t('Run ID: {0}', state.trace.runId),
                  ...(localTrace.length
                      ? [
                            '',
                            l10n.t(
                                'The log follows SDK HTTP requests, not network hops. Proxy settings are configuration evidence, not proof of the route. DNS addresses are resolved by the extension host.',
                            ),
                        ]
                      : []),
                  '',
                  '```text',
                  ...(localTrace.length ? localTrace : state.trace.lines),
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
            checks: state.checks.map(
                ({ step, finding, status, auth, network, networkDiagnosis, failureStage, http }) => ({
                    step,
                    finding,
                    status,
                    auth,
                    failureStage,
                    networkDiagnosis,
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
                }),
            ),
            log: state.trace?.lines,
        },
        undefined,
        2,
    );
}
