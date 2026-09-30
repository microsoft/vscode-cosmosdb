/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TypedEventSink } from '@microsoft/vscode-ext-webview';
import { initTRPC } from '@trpc/server';
import { beforeEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getCosmosDBCredentials, type CosmosDBCredential } from '../../../../cosmosdb/CosmosDBCredential';
import { ext } from '../../../../extensionVariables';
import { type DataModelerAccount } from '../../../../services/DataModelerProjectService';
import { QueryEditorTab } from '../../../QueryEditorTab';
import { type AccountOverviewEvent, type AccountOverviewRouterContext } from '../../appRouter';
import { actionsProcedures } from './actionsRouter';

vi.mock('@microsoft/vscode-azext-azureutils', () => ({ parseAzureResourceId: vi.fn() }));
vi.mock('@microsoft/vscode-azext-utils', () => ({ callWithTelemetryAndErrorHandling: vi.fn() }));
vi.mock('../../trpc', async () => {
    const { initTRPC } = await import('@trpc/server');
    return { accountOverviewProcedure: initTRPC.context<AccountOverviewRouterContext>().create().procedure };
});
vi.mock('../../../../cosmosdb/controlPlane/ArmCosmosDBControlPlane', () => ({
    ArmCosmosDBControlPlane: vi.fn(),
}));
vi.mock('../../../../cosmosdb/CosmosDBCredential', () => ({ getCosmosDBCredentials: vi.fn() }));
vi.mock('../../../../vscodeUriHandler', () => ({ revealAzureResourceInExplorer: vi.fn() }));
vi.mock('../../../QueryEditorTab', () => ({ QueryEditorTab: { render: vi.fn() } }));
vi.mock('../../../../extensionVariables', () => ({ ext: { isAIFeaturesEnabled: undefined } }));

beforeEach(() => vi.clearAllMocks());

it.each([undefined, false, true])('streams initial AI availability (%s) and live changes', async (available) => {
    ext.isAIFeaturesEnabled = available;
    const sink = new TypedEventSink<AccountOverviewEvent>();
    const caller = initTRPC
        .context<AccountOverviewRouterContext>()
        .create()
        .router(actionsProcedures)
        .createCaller({
            metadata: {} as AccountOverviewRouterContext['metadata'],
            webviewName: 'cosmosDbAccountOverview',
            aiFeaturesChanged: sink,
        });
    const stream = await caller.aiFeaturesEnabled();
    const iterator = stream[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: available ?? false, done: false });
    const enabled = iterator.next();
    sink.emit({ type: 'aiFeaturesEnabledChanged', isEnabled: true });
    expect(await enabled).toEqual({ value: true, done: false });
    const disabled = iterator.next();
    sink.emit({ type: 'aiFeaturesEnabledChanged', isEnabled: false });
    expect(await disabled).toEqual({ value: false, done: false });
    sink.close();
    expect((await iterator.next()).done).toBe(true);
});

it('shares the Account Overview Query Editor connection factory with the Data Modeler', async () => {
    const metadata = {
        accountName: 'source-account',
        documentEndpoint: 'https://source.documents.azure.com/',
        subscription: { tenantId: 'tenant' },
    } as AccountOverviewRouterContext['metadata'];
    const ctx = { metadata } as AccountOverviewRouterContext;
    const credentials: CosmosDBCredential[] = [];
    vi.mocked(getCosmosDBCredentials).mockResolvedValue(credentials);
    const executeCommand = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    const caller = initTRPC
        .context<AccountOverviewRouterContext>()
        .create()
        .router(actionsProcedures)
        .createCaller(ctx);
    await caller.openDataModeler();
    expect(getCosmosDBCredentials).not.toHaveBeenCalled();
    expect(executeCommand).toHaveBeenCalledWith(
        'cosmosDB.dataModeling.open',
        expect.objectContaining({ getQueryConnection: expect.any(Function) }),
    );
    const account = executeCommand.mock.calls.at(-1)?.[1] as DataModelerAccount;
    const connection = await account.getQueryConnection?.('deployed-db', 'Orders');
    expect(getCosmosDBCredentials).toHaveBeenCalledWith({
        accountName: metadata.accountName,
        documentEndpoint: metadata.documentEndpoint,
        tenantId: metadata.subscription.tenantId,
        isEmulator: false,
        arm: metadata,
    });
    expect(connection).toEqual({
        azureMetadata: metadata,
        databaseId: 'deployed-db',
        containerId: 'Orders',
        endpoint: metadata.documentEndpoint,
        credentials,
        isEmulator: false,
    });
    await caller.openQueryEditor({ databaseId: 'deployed-db', containerId: 'Orders' });
    expect(QueryEditorTab.render).toHaveBeenCalledWith(connection);
});
