/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TypedEventSink } from '@microsoft/vscode-ext-webview';
import { attachTrpc } from '@microsoft/vscode-ext-webview/host';
import * as vscode from 'vscode';
import { type AzureResourceMetadata } from '../cosmosdb/AzureResourceMetadata';
import { type CosmosDBAccountResourceItem } from '../tree/cosmosdb/CosmosDBAccountResourceItem';
import { BaseTab } from './BaseTab';
import {
    accountOverviewAppRouter,
    accountOverviewCallerFactory,
    type AccountOverviewEvent,
    type AccountOverviewRouterContext,
} from './trpc/appRouter';

export class AccountOverviewTab extends BaseTab {
    public static readonly title = 'Account Overview';
    public static readonly viewType = 'cosmosDbAccountOverview';
    public static readonly openTabs: Set<AccountOverviewTab> = new Set<AccountOverviewTab>();

    private readonly aiFeaturesChanged = new TypedEventSink<AccountOverviewEvent>();
    private readonly metadata: AzureResourceMetadata;
    /** The account node this overview was opened from, used to scope footer actions. */
    private readonly accountNode?: CosmosDBAccountResourceItem;

    protected constructor(
        panel: vscode.WebviewPanel,
        metadata: AzureResourceMetadata,
        accountNode?: CosmosDBAccountResourceItem,
    ) {
        super(panel, AccountOverviewTab.viewType);

        AccountOverviewTab.openTabs.add(this);
        this.metadata = metadata;
        this.accountNode = accountNode;
        this.panel.title = `${AccountOverviewTab.title}: ${metadata.accountName}`;

        const { disposable } = attachTrpc(
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
        accountNode?: CosmosDBAccountResourceItem,
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

        return new AccountOverviewTab(panel, metadata, accountNode);
    }

    public static notifyAIFeaturesChanged(available: boolean): void {
        for (const tab of AccountOverviewTab.openTabs) {
            tab.aiFeaturesChanged.emit({ type: 'aiFeaturesEnabledChanged', isEnabled: available });
        }
    }

    public dispose(): void {
        AccountOverviewTab.openTabs.delete(this);
        this.aiFeaturesChanged.close();
        super.dispose();
    }

    private buildRouterContext(): AccountOverviewRouterContext {
        return {
            webviewName: AccountOverviewTab.viewType,
            metadata: this.metadata,
            accountNode: this.accountNode,
            aiFeaturesChanged: this.aiFeaturesChanged,
        };
    }
}
