/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type LogsFailureKind } from './services/advisories/fetchers/logsDiagnostics';
import { type UnavailableReason } from './services/shared';

export type ReadSource =
    | 'account'
    | 'inventory'
    | 'metrics'
    | 'activityLog'
    | 'advisor'
    | 'alerts'
    | 'alertCounts'
    | 'logs';

/** Only bounded categories cross the RPC boundary; service messages and identifiers remain local to Output. */
export interface ReadFailure {
    source: ReadSource;
    kind: LogsFailureKind;
    reason: UnavailableReason;
}

export interface ReadDiagnosticsResult {
    diagnostics?: ReadFailure[];
}

export const READ_PERMISSIONS: Record<ReadSource, readonly string[]> = {
    account: ['Microsoft.DocumentDB/databaseAccounts/read'],
    inventory: [
        'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/read',
        'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/read',
        'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/throughputSettings/read',
        'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/throughputSettings/read',
    ],
    metrics: ['Microsoft.Insights/Metrics/read'],
    activityLog: ['Microsoft.Insights/eventtypes/values/Read'],
    advisor: ['Microsoft.Advisor/recommendations/read'],
    alerts: ['Microsoft.AlertsManagement/alerts/read'],
    alertCounts: ['Microsoft.ResourceGraph/resources/read', 'Microsoft.AlertsManagement/alerts/read'],
    logs: ['Microsoft.Insights/logs/*/read'],
};
