/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { setupTrpc } from '@cosmosdb/webview-rpc/server';
import * as vscode from 'vscode';
import { type AzureResourceMetadata } from '../cosmosdb/AzureResourceMetadata';
import { BaseTab } from './BaseTab';
import {
    accountOverviewAppRouter,
    accountOverviewCallerFactory,
    type AccountOverviewRouterContext,
} from './trpc/appRouter';

export class AccountOverviewTab extends BaseTab {
    public static readonly title = 'Account Overview';
    public static readonly viewType = 'cosmosDbAccountOverview';
    public static readonly openTabs: Set<AccountOverviewTab> = new Set<AccountOverviewTab>();

    private readonly metadata: AzureResourceMetadata;

    protected constructor(panel: vscode.WebviewPanel, metadata: AzureResourceMetadata) {
        super(panel, AccountOverviewTab.viewType);

        AccountOverviewTab.openTabs.add(this);
        this.metadata = metadata;
        this.panel.title = `${AccountOverviewTab.title}: ${metadata.accountName}`;

        const { disposable } = setupTrpc(
            this.panel,
            this.buildRouterContext(),
            accountOverviewAppRouter,
            accountOverviewCallerFactory,
        );
        this.disposables.push(disposable);
    }

    /**
     * Singleton policy: one panel per `accountId`. Re-invoking the command for
     * the same account reveals the existing panel instead of opening a new one.
     */
    public static render(
        metadata: AzureResourceMetadata,
        viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active,
    ): AccountOverviewTab {
        const openTab = [...AccountOverviewTab.openTabs].find((tab) => tab.metadata.accountId === metadata.accountId);
        if (openTab) {
            openTab.panel.reveal(viewColumn);
            return openTab;
        }

        const panel = vscode.window.createWebviewPanel(
            AccountOverviewTab.viewType,
            AccountOverviewTab.title,
            viewColumn,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        return new AccountOverviewTab(panel, metadata);
    }

    public dispose(): void {
        AccountOverviewTab.openTabs.delete(this);
        super.dispose();
    }

    private buildRouterContext(): AccountOverviewRouterContext {
        return {
            webviewName: AccountOverviewTab.viewType,
            metadata: this.metadata,
        };
    }
}
