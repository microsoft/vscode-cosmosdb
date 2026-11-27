/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { logWindow, probeCdbLogs } from '../panels/accountOverview/services/advisories/fetchers/logs';
import { classifyUnavailable } from '../panels/accountOverview/services/shared';
import {
    createAdvisorClient,
    createAlertsManagementClient,
    createLogsQueryClient,
    createMonitorClient,
} from '../utils/azureClients';
import { getHttpFailure } from './classify';
import { type CheckResult, type Finding, type OverviewStep, overviewSteps } from './model';
import { StepTimeoutError, withStepTimeout } from './stepTimeout';
import { type DiagnosticsAzureAccount } from './target';

type ReadProbe = (signal: AbortSignal) => Promise<Finding>;
type LogTable = NonNullable<NonNullable<Parameters<typeof probeCdbLogs>[3]>['table']>;
const overviewTimeoutMs = 6_000;

/** Probe actual read access using the Overview's Azure identity, independently of Cosmos DB credentials. */
export async function checkOverviewAccess(
    account: DiagnosticsAzureAccount,
    signal: AbortSignal,
    onCheckComplete: (step: OverviewStep) => void,
): Promise<CheckResult[]> {
    const results = await callWithTelemetryAndErrorHandling(
        'cosmosDB.diagnostics.checkOverviewAccess',
        async (context) => {
            context.errorHandling.suppressDisplay = true;
            context.errorHandling.rethrow = false;
            context.telemetry.maskEntireErrorMessage = true;
            context.telemetry.suppressIfSuccessful = true;
            context.valuesToMask.push(
                account.id,
                account.id.replace(/^\/+/, ''),
                account.name,
                account.subscription.subscriptionId,
            );
            if (account.resourceGroup) context.valuesToMask.push(account.resourceGroup);
            const probes = overviewProbes(account, context);
            return Promise.all(
                overviewSteps.map(async (step) => {
                    const result = await runReadCheck(step, signal, probes[step]);
                    onCheckComplete(step);
                    return result;
                }),
            );
        },
    );
    signal.throwIfAborted();
    return results ?? overviewSteps.map((step) => overviewResult(step, 'overviewUnavailable'));
}

function overviewProbes(account: DiagnosticsAzureAccount, context: IActionContext): Record<OverviewStep, ReadProbe> {
    const { id, subscription } = account;
    let logs: ReturnType<typeof createLogsQueryClient> | undefined;
    const getLogs = () => (logs ??= createLogsQueryClient(context, subscription, { createIfNone: false }));

    return {
        metrics: async (abortSignal) => {
            const client = await createMonitorClient(context, subscription);
            abortSignal.throwIfAborted();
            await client.metrics.list(id, {
                metricnames: 'TotalRequests',
                aggregation: 'Count',
                interval: 'PT5M',
                timespan: recentWindow(),
                abortSignal,
            });
            return 'overviewRead';
        },
        alerts: async (abortSignal) => {
            const client = await createAlertsManagementClient(subscription);
            abortSignal.throwIfAborted();
            await client.alerts
                .getAll(`/subscriptions/${subscription.subscriptionId}`, {
                    targetResource: id,
                    timeRange: '1d',
                    monitorCondition: 'Fired',
                    pageCount: 1,
                    abortSignal,
                })
                .byPage()
                .next();
            return 'overviewRead';
        },
        advisor: async (abortSignal) => {
            const client = await createAdvisorClient(context, subscription);
            abortSignal.throwIfAborted();
            await client.recommendations.list({ top: 1, abortSignal }).byPage().next();
            return 'overviewRead';
        },
        requestLogs: (signal) => readLogs(id, 'CDBDataPlaneRequests', getLogs, context, signal),
        queryLogs: (signal) => readLogs(id, 'CDBQueryRuntimeStatistics', getLogs, context, signal),
    };
}

async function readLogs(
    resourceId: string,
    table: LogTable,
    getClient: () => ReturnType<typeof createLogsQueryClient>,
    context: IActionContext,
    abortSignal: AbortSignal,
): Promise<Finding> {
    const client = await getClient();
    abortSignal.throwIfAborted();
    let unauthorized = false;
    const result = await probeCdbLogs(
        {
            queryResource: (resource, query, timespan) => {
                context.valuesToMask.push(query);
                return client.queryResource(resource, query, timespan, { abortSignal });
            },
        },
        resourceId,
        logWindow(),
        {
            table,
            onDiagnostic: ({ statusCode }) => {
                unauthorized = statusCode === 401;
            },
        },
    );
    if (result.available) return 'overviewRead';
    if (unauthorized) return 'overviewAuthentication';
    if (result.reason === 'rbac') return 'overviewDenied';
    if (result.reason === 'logAnalyticsDisabled') return 'overviewLogsMissing';
    return 'overviewUnavailable';
}

function recentWindow(): string {
    const now = Date.now();
    return `${new Date(now - 5 * 60_000).toISOString()}/${new Date(now).toISOString()}`;
}

async function runReadCheck(step: OverviewStep, signal: AbortSignal, read: ReadProbe): Promise<CheckResult> {
    try {
        return overviewResult(step, await withStepTimeout(signal, overviewTimeoutMs, read));
    } catch (error) {
        signal.throwIfAborted();
        const http = getHttpFailure(error);
        const finding =
            error instanceof StepTimeoutError
                ? 'overviewTimedOut'
                : http?.status === 401
                  ? 'overviewAuthentication'
                  : http?.status === 403 || classifyUnavailable(error) === 'rbac'
                    ? 'overviewDenied'
                    : 'overviewUnavailable';
        return { ...overviewResult(step, finding), ...(http ? { http: { status: http.status } } : {}) };
    }
}

function overviewResult(step: OverviewStep, finding: Finding): CheckResult {
    return { step, finding, status: finding === 'overviewRead' ? 'passed' : 'info' };
}
