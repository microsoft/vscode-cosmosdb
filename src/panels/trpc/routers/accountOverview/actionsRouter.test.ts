/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { initTRPC } from '@trpc/server';
import { beforeEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getCosmosDBCredentials, type CosmosDBCredential } from '../../../../cosmosdb/CosmosDBCredential';
import { type DataModelerAccount } from '../../../../services/DataModelerProjectService';
import { QueryEditorTab } from '../../../QueryEditorTab';
import { type AccountOverviewRouterContext } from '../../appRouter';
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

beforeEach(() => vi.clearAllMocks());

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
