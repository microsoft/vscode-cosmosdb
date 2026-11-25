/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type CheckResult, type TargetKind } from './model';

export const diagnosticsHelpUrls = {
    forbidden: 'https://learn.microsoft.com/azure/cosmos-db/troubleshoot-forbidden',
    ipFirewall: 'https://learn.microsoft.com/azure/cosmos-db/how-to-configure-firewall',
    virtualNetwork: 'https://learn.microsoft.com/azure/cosmos-db/how-to-configure-vnet-service-endpoint',
    privateLink: 'https://learn.microsoft.com/azure/cosmos-db/how-to-configure-private-endpoints',
    dataRbac: 'https://learn.microsoft.com/azure/cosmos-db/how-to-connect-role-based-access-control',
    proxy: 'https://code.visualstudio.com/docs/setup/network',
    emulator: 'https://learn.microsoft.com/azure/cosmos-db/emulator',
} as const;

export type DiagnosticsHelpTopic = keyof typeof diagnosticsHelpUrls;

export function helpLabel(topic: DiagnosticsHelpTopic): string {
    return {
        forbidden: l10n.t('Troubleshoot Cosmos DB HTTP 403'),
        ipFirewall: l10n.t('Configure the Cosmos DB IP firewall'),
        virtualNetwork: l10n.t('Configure Cosmos DB virtual network access'),
        privateLink: l10n.t('Configure Cosmos DB Private Link and DNS'),
        dataRbac: l10n.t('Learn about Cosmos DB data-plane roles'),
        proxy: l10n.t('Configure VS Code network and proxy settings'),
        emulator: l10n.t('Configure the Cosmos DB emulator'),
    }[topic];
}

export function checkHelpTopics(check: CheckResult, kind: TargetKind): readonly DiagnosticsHelpTopic[] {
    if (kind === 'emulator') return check.status === 'failed' ? ['emulator'] : [];
    switch (check.finding) {
        case 'firewallPublic':
            return ['ipFirewall', 'forbidden'];
        case 'firewallServiceEndpoint':
            return ['virtualNetwork', 'forbidden'];
        case 'firewallPrivateEndpoint':
            return ['privateLink', 'forbidden'];
        case 'firewallUnknown':
        case 'dataPlaneOperationDenied':
            return ['forbidden'];
        case 'forbiddenUnknown':
            return ['forbidden', 'dataRbac'];
        case 'dataRbac':
        case 'localAuthDisabled':
        case 'authentication':
        case 'missingCredentials':
            return ['dataRbac'];
        case 'mixedDns':
            return ['privateLink'];
        case 'unresolvedDns':
        case 'dnsFailure':
        case 'tlsFailure':
        case 'proxyAuthentication':
        case 'transportFailure':
        case 'timedOut':
            return ['proxy'];
        default:
            return [];
    }
}
