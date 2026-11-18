/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { initWebviewTrpc } from '@microsoft/vscode-ext-webview';
import {
    type inferProcedureBuilderResolverOptions,
    type inferProcedureInput,
    type inferProcedureOutput,
} from '@trpc/server';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import { ArmTestMetadata, createArmTestClient, createArmTestContext } from '../../../../cosmosdb/armTestUtils';
import { readRequest } from '../../../accountOverview/services/readDiagnostics';
import { mockClient } from '../../../accountOverview/services/testFixtures';
import { type AccountOverviewRouterContext } from '../../appRouter';
import { accountOverviewTelemetryMiddleware } from '../../middleware/accountOverviewTelemetryMiddleware';
import {
    accountOverviewProcedure,
    accountOverviewRouter,
    type dataModelingProcedure,
    type documentProcedure,
    type migrationProcedure,
    type queryEditorProcedure,
} from '../../trpc';
import { actionsProcedures } from './actionsRouter';
import { metricSeriesProcedures } from './metricSeriesRouter';
import { readAccountData } from './readData';

const mocks = vi.hoisted(() => ({
    events: [] as { name: string; context: IActionContext }[],
}));

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(async (name: string, callback: (context: IActionContext) => unknown) => {
        const context = createArmTestContext();
        mocks.events.push({ name, context });
        try {
            return await callback(context);
        } catch (error) {
            context.telemetry.properties.result = 'Failed';
            if (context.errorHandling.rethrow) {
                throw error;
            }
            return undefined;
        }
    }),
}));
vi.mock('@microsoft/vscode-azext-azureutils', () => ({ parseAzureResourceId: vi.fn() }));
vi.mock('@microsoft/vscode-azureresources-api', () => ({}));
vi.mock('../../../../utils/azureClients', () => ({}));
vi.mock('../../../../cosmosdb/CosmosDBCredential', () => ({ getCosmosDBCredentials: vi.fn() }));
vi.mock('../../../../extensionVariables', () => ({
    ext: { outputChannel: { debug: vi.fn(), warn: vi.fn(), show: vi.fn() } },
}));
vi.mock('../../../../vscodeUriHandler', () => ({ revealAzureResourceInExplorer: vi.fn() }));
vi.mock('../../../QueryEditorTab', () => ({ QueryEditorTab: { render: vi.fn() } }));
vi.mock('../../../accountOverview/services/accountActions', () => ({ runAccountAction: vi.fn() }));

class TestMetadata extends ArmTestMetadata {
    public override getMonitorClient = vi.fn<ArmTestMetadata['getMonitorClient']>().mockResolvedValue(mockClient({}));
}

function createCaller() {
    const metadata = new TestMetadata(createArmTestClient());
    const context: AccountOverviewRouterContext = {
        webviewName: 'cosmosDbAccountOverview',
        metadata,
        panelId: 'random-panel-id',
        getInitialization: () => ({ type: 'navigate', target: 'overview', revision: 0 }),
        onNavigation: () => ({ dispose() {} }),
    };
    return {
        metadata,
        caller: accountOverviewRouter({
            ...actionsProcedures,
            ...metricSeriesProcedures,
            queryResult: accountOverviewProcedure.input(z.unknown()).query(({ input }) => input),
            mutationResult: accountOverviewProcedure.mutation(() => ({ available: true })),
            subscriptionResult: accountOverviewProcedure.subscription(async function* () {
                yield { available: true };
            }),
            lateFailure: accountOverviewProcedure.query(({ ctx }) =>
                readAccountData(
                    ctx.metadata,
                    'metrics',
                    async () => {
                        await Promise.all([
                            readRequest('metrics', 'first', async () => {
                                await new Promise<void>((resolve) => setTimeout(resolve, 10));
                                throw Object.assign(new Error('Service unavailable.'), { statusCode: 503 });
                            }),
                            readRequest('logs', 'sibling', async () => {
                                await new Promise<void>((resolve) => setTimeout(resolve, 50));
                                throw Object.assign(new Error('Access to private-db was denied.'), { statusCode: 403 });
                            }),
                        ]);
                        return { available: true };
                    },
                    () => ({ available: false }),
                ),
            ),
            fail: accountOverviewProcedure
                .input(z.object({ databaseId: z.string(), count: z.number().optional() }))
                .query(({ ctx }) => {
                    expect(ctx.actionContext.valuesToMask).toEqual(
                        expect.arrayContaining(['account-id', 'account', 'rg', 'sub-1', 'private-db']),
                    );
                    throw new Error('SDK action failed for private-db');
                }),
        }).createCaller(context),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
});

describe('Account Overview RPC telemetry', () => {
    it('requires the telemetry prerequisite at compile time, without changing the caller context', () => {
        const { publicProcedure } = initWebviewTrpc<AccountOverviewRouterContext>();
        publicProcedure.use(({ ctx, next }) => {
            expectTypeOf(ctx.actionContext).toEqualTypeOf<IActionContext | undefined>();
            return next();
        });
        // @ts-expect-error Overview enrichment cannot precede the middleware that provides actionContext.
        publicProcedure.use(accountOverviewTelemetryMiddleware);
        // @ts-expect-error Logging alone does not provide actionContext either.
        publicProcedure.use(({ next }) => next()).use(accountOverviewTelemetryMiddleware);
    });

    it('preserves required action contexts and router-specific types through the shared middleware', () => {
        expectTypeOf<
            inferProcedureBuilderResolverOptions<typeof queryEditorProcedure>['ctx']['actionContext']
        >().toEqualTypeOf<IActionContext>();
        expectTypeOf<
            inferProcedureBuilderResolverOptions<typeof documentProcedure>['ctx']['actionContext']
        >().toEqualTypeOf<IActionContext>();
        expectTypeOf<
            inferProcedureBuilderResolverOptions<typeof migrationProcedure>['ctx']['actionContext']
        >().toEqualTypeOf<IActionContext>();
        expectTypeOf<
            inferProcedureBuilderResolverOptions<typeof dataModelingProcedure>['ctx']['actionContext']
        >().toEqualTypeOf<IActionContext>();
        const procedure = accountOverviewProcedure.input(z.object({ count: z.number() })).query(({ ctx, input }) => {
            expectTypeOf(ctx.actionContext).toEqualTypeOf<IActionContext>();
            expectTypeOf(ctx.metadata).toEqualTypeOf<AccountOverviewRouterContext['metadata']>();
            return { count: input.count };
        });
        expectTypeOf<inferProcedureInput<typeof procedure>>().toEqualTypeOf<{ count: number }>();
        expectTypeOf<inferProcedureOutput<typeof procedure>>().toEqualTypeOf<{ count: number }>();
    });

    it('masks account and input values before failures while preserving rejection and suppressing native UI', async () => {
        const { caller } = createCaller();
        await expect(caller.fail({ databaseId: 'private-db' })).rejects.toThrow('SDK action failed');
        expect(mocks.events).toHaveLength(1);
        const { context } = mocks.events[0];
        expect(context.errorHandling.suppressDisplay).toBe(true);
        expect(context.telemetry.properties).toMatchObject({
            panelId: 'random-panel-id',
            isServerless: 'false',
            errorCategory: 'infrastructure',
            result: 'Failed',
        });
        expect(context.telemetry.properties.dataResult).toBeUndefined();
        expect(context.telemetry.measurements.readFailureCount).toBeUndefined();
    });

    it('masks sensitive raw input even when validation fails before the resolver', async () => {
        const { caller } = createCaller();
        await expect(caller.fail({ databaseId: 'private-db', count: NaN })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        });
        expect(mocks.events).toHaveLength(1);
        expect(mocks.events[0].context.valuesToMask).toContain('private-db');
        expect(mocks.events[0].context.telemetry.properties).toMatchObject({
            errorCategory: 'infrastructure',
            result: 'Failed',
        });
    });

    it('records an SDK error that was converted into a structured unavailable result', async () => {
        const { caller, metadata } = createCaller();
        metadata.getMonitorClient.mockRejectedValueOnce(
            Object.assign(new Error('Access to private-db was denied'), { statusCode: 403 }),
        );
        const result = await caller.getMetricSeries({
            metric: 'totalRequests',
            timeRange: '1H',
            databaseId: 'private-db',
        });
        expect(result).toMatchObject({ available: false, reason: 'rbac' });
        const { context } = mocks.events[0];
        expect(context.telemetry.properties).toMatchObject({
            dataResult: 'unavailable',
            metric: 'totalRequests',
            timeRange: '1H',
            scope: 'database',
            readFailureKinds: 'accessDenied',
            readFailureSources: 'metrics',
            errorCategory: 'infrastructure',
        });
        expect(context.telemetry.measurements.readFailureCount).toBe(1);
        expect(JSON.stringify(context.telemetry)).not.toMatch(/private-db|Access to/);
        expect(mocks.events).toHaveLength(1);
    });

    it('enriches structured query results without requiring the read helper or a telemetry callback', async () => {
        const { caller } = createCaller();
        const result = {
            available: true,
            diagnostics: [{ source: 'logs', kind: 'partialFailure', reason: 'rbac' }],
            advisories: [{ evidence: { scope: 'private-container', cost: 123 } }],
            detectorCoverage: [
                {
                    rule: 'HotPartitionRisk',
                    status: 'partial',
                    evaluatedCount: 2,
                    matchedCount: 1,
                    notApplicableCount: 0,
                    insufficientDataCount: 1,
                    unavailableReasons: ['rbac'],
                },
            ],
            metricSource: { available: true, failures: [] },
            logSource: { available: false, failures: [{}] },
            costSource: { available: false, failures: [{ kind: 'accessDenied' }] },
        };
        await expect(caller.queryResult(result)).resolves.toEqual(result);
        expect(mocks.events).toHaveLength(1);
        expect(mocks.events[0].context.telemetry.properties).toMatchObject({
            dataResult: 'partial',
            errorCategory: 'infrastructure',
            readFailureSources: 'logs',
            readFailureKinds: 'partialFailure',
            readFailureReasons: 'rbac',
            metricCoverage: 'true',
            logCoverage: 'false',
            costCoverage: 'false',
            costFailureKinds: 'accessDenied',
            detectorHotPartitionRiskStatus: 'partial',
            detectorHotPartitionRiskUnavailableReasons: 'rbac',
        });
        expect(mocks.events[0].context.telemetry.measurements).toEqual({
            readFailureCount: 1,
            advisoryCount: 1,
            skippedMetricCheckCount: 0,
            failedLogCheckCount: 1,
            costFailureCount: 1,
            detectorHotPartitionRiskEvaluatedCount: 2,
            detectorHotPartitionRiskMatchedCount: 1,
            detectorHotPartitionRiskInsufficientDataCount: 1,
        });
        expect(JSON.stringify(mocks.events[0].context.telemetry)).not.toMatch(/private-|123/);
    });

    it('waits for late sibling diagnostics before enriching the RPC event', async () => {
        vi.useFakeTimers();
        try {
            const response = createCaller().caller.lateFailure();
            await vi.advanceTimersByTimeAsync(10);
            expect(mocks.events).toHaveLength(1);
            expect(mocks.events[0].context.telemetry.measurements.readFailureCount).toBeUndefined();
            await vi.advanceTimersByTimeAsync(40);
            await expect(response).resolves.toMatchObject({
                available: false,
                diagnostics: [
                    { source: 'metrics', kind: 'transient', reason: 'noData' },
                    { source: 'logs', kind: 'accessDenied', reason: 'rbac' },
                ],
            });
            expect(mocks.events).toHaveLength(1);
            expect(mocks.events[0].context.telemetry.properties).toMatchObject({
                dataResult: 'unavailable',
                readFailureSources: 'logs,metrics',
                readFailureKinds: 'accessDenied,transient',
                readFailureReasons: 'noData,rbac',
            });
            expect(mocks.events[0].context.telemetry.measurements.readFailureCount).toBe(2);
        } finally {
            await vi.runAllTimersAsync();
            vi.useRealTimers();
        }
    });

    it('does not attach read summaries to other queries, mutations or subscription setup', async () => {
        const { caller } = createCaller();
        await caller.queryResult({ accountName: 'private-account' });
        await caller.mutationResult();
        const subscription = await caller.subscriptionResult();
        for await (const value of subscription) {
            expect(value).toEqual({ available: true });
        }
        expect(mocks.events).toHaveLength(3);
        for (const { context } of mocks.events) {
            expect(context.telemetry.properties.dataResult).toBeUndefined();
            expect(context.telemetry.measurements.readFailureCount).toBeUndefined();
            expect(context.telemetry.properties.errorCategory).toBeUndefined();
        }
    });

    it('uses independent masks and does not report successful empty reads as exceptions', async () => {
        const { caller } = createCaller();
        for (const databaseId of ['first-db', 'second-db']) {
            await caller.getMetricSeries({ metric: 'totalRequests', timeRange: '24H', databaseId });
        }
        expect(mocks.events).toHaveLength(2);
        expect(mocks.events[0].context.valuesToMask).toContain('first-db');
        expect(mocks.events[1].context.valuesToMask).toContain('second-db');
        expect(mocks.events[1].context.valuesToMask).not.toContain('first-db');
        expect(mocks.events[1].context.telemetry.properties).toMatchObject({ dataResult: 'unavailable' });
        expect(mocks.events[1].context.telemetry.properties.errorCategory).toBeUndefined();
        expect(mocks.events[1].context.telemetry.measurements.readFailureCount).toBe(0);
    });

    it('emits one bounded tab event, suppressing the successful transport event', async () => {
        await createCaller().caller.reportEvent({
            eventName: 'tabViewed',
            properties: { tab: 'databases', trigger: 'user' },
        });
        expect(mocks.events.map(({ name }) => name)).toEqual([
            'cosmosDB.rpc.mutation.reportEvent',
            'cosmosDB.accountOverview.webview.tabViewed',
        ]);
        expect(mocks.events[0].context.telemetry.suppressIfSuccessful).toBe(true);
        expect(mocks.events[1].context.telemetry.properties).toEqual({
            panelId: 'random-panel-id',
            tab: 'databases',
            trigger: 'user',
        });
        expect(mocks.events[1].context.errorHandling).toMatchObject({ suppressDisplay: true, rethrow: false });
        expect(mocks.events[1].context.valuesToMask).toContain('account');
    });

    it('reports client failure categories without rejecting the reporting RPC or displaying a notification', async () => {
        await expect(createCaller().caller.reportError({ kind: 'render' })).resolves.toBeUndefined();
        const event = mocks.events.find(({ name }) => name === 'cosmosDB.accountOverview.webviewError');
        expect(event?.context.telemetry.properties).toEqual({
            errorCategory: 'webview',
            failureKind: 'render',
            panelId: 'random-panel-id',
            result: 'Failed',
        });
        expect(event?.context.errorHandling).toMatchObject({ suppressDisplay: true, rethrow: false });
    });
});
