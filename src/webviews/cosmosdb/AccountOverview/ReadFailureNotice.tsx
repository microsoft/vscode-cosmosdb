/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Link } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import {
    READ_PERMISSIONS,
    type ReadFailure,
    type ReadSource,
} from '../../../panels/accountOverview/accessRequirements';
import { CollapsibleNotice } from './CollapsibleNotice';
import { useDashboardActions } from './DashboardChrome';

function sourceLabel(source: ReadSource): string {
    const labels: Record<ReadSource, string> = {
        account: l10n.t('Account configuration'),
        inventory: l10n.t('Inventory and throughput'),
        metrics: l10n.t('Azure Monitor metrics'),
        activityLog: l10n.t('Azure Activity Log'),
        advisor: l10n.t('Azure Advisor recommendations'),
        alerts: l10n.t('Azure Monitor alerts'),
        alertCounts: l10n.t('Resource Graph alert counts'),
        logs: l10n.t('Log Analytics'),
    };
    return labels[source];
}

function permissionGuidance(source: ReadSource): string {
    switch (source) {
        case 'account':
        case 'inventory':
            return l10n.t(
                'Ask for Reader on this Cosmos DB account, or equivalent read permissions inherited from a parent scope.',
            );
        case 'metrics':
            return l10n.t(
                'Ask for Reader or Monitoring Reader on this Cosmos DB account, or equivalent metric-read permissions.',
            );
        case 'advisor':
        case 'alerts':
            return l10n.t(
                'Ask for Reader or Monitoring Reader on the associated resources, or equivalent read permissions.',
            );
        case 'activityLog':
        case 'alertCounts':
            return l10n.t(
                'Subscription-scoped Reader or Monitoring Reader is a broad option. Equivalent read permissions at appropriate scopes can also work; a narrower minimum is not established here.',
            );
        case 'logs':
            return l10n.t(
                'Resource-context queries normally use Reader on this account. If the workspace requires workspace permissions, ask for Log Analytics Reader or equivalent access. Allow the CDB tables used by the failed checks: CDBDataPlaneRequests5M, CDBDataPlaneRequests and CDBQueryRuntimeStatistics. Check any table or row restrictions.',
            );
    }
}

function failureDescription(failure: ReadFailure): string {
    if (failure.kind === 'authentication') {
        return l10n.t(
            'Sign-in required. Check your Azure sign-in, tenant and credentials; assigning a role alone may not resolve this failure.',
        );
    }
    if (failure.reason === 'rbac') {
        return l10n.t('Access denied.') + ' ' + permissionGuidance(failure.source);
    }
    if (failure.kind === 'missingTable') {
        return l10n.t(
            'Required table unavailable. Check diagnostic categories, resource-specific export mode, ingestion and table access.',
        );
    }
    if (failure.kind === 'clientUnavailable') {
        return l10n.t('Client unavailable. Check Azure sign-in and see Output for diagnostics.');
    }
    return l10n.t(
        'The request failed or returned an incomplete result. This is not evidence that no data exists. See Output for diagnostics.',
    );
}

export const ReadFailureNotice = ({ failures }: { failures: readonly ReadFailure[] }) => {
    const { showOutput, openUrl } = useDashboardActions();
    const unique = new Map(failures.map((failure) => [`${failure.source}:${failure.kind}:${failure.reason}`, failure]));
    if (unique.size === 0) {
        return null;
    }
    return (
        <CollapsibleNotice
            title={l10n.t('Some account data could not be loaded')}
            intent="warning"
            actions={
                <>
                    <Button size="small" onClick={showOutput}>
                        {l10n.t('Show Output')}
                    </Button>
                    <Link
                        as="button"
                        onClick={() => openUrl('https://learn.microsoft.com/azure/role-based-access-control/overview')}
                    >
                        {l10n.t('Learn more about Azure roles')}
                    </Link>
                </>
            }
        >
            <div>
                {l10n.t(
                    'Successful checks remain available. Review the failed sources below; service diagnostics are recorded in the Azure Cosmos DB Output channel.',
                )}
            </div>
            <ul>
                {[...unique].map(([key, failure]) => (
                    <li key={key}>
                        <strong>{sourceLabel(failure.source)}</strong> {failureDescription(failure)}
                        {failure.reason === 'rbac' && failure.kind !== 'authentication' && (
                            <ul>
                                {READ_PERMISSIONS[failure.source].map((permission) => (
                                    <li key={permission}>
                                        <code>{permission}</code>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </li>
                ))}
            </ul>
        </CollapsibleNotice>
    );
};
