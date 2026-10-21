/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { attachTrpc } from '@microsoft/vscode-ext-webview/host';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type AzureResourceMetadata } from '../cosmosdb/AzureResourceMetadata';
import {
    isAccountOverviewTarget,
    type AccountOverviewNavigation,
    type AccountOverviewTarget,
} from './accountOverview/navigation';
import { getAccountOverviewMaskedValues } from './accountOverview/resourceMasking';
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

    private metadata: AzureResourceMetadata;
    private initialization: AccountOverviewNavigation;
    private readonly navigationEmitter = new vscode.EventEmitter<AccountOverviewNavigation>();

    protected constructor(panel: vscode.WebviewPanel, metadata: AzureResourceMetadata, target: AccountOverviewTarget) {
        super(panel, AccountOverviewTab.viewType);

        this.metadata = metadata;
        this.initialization = { type: 'navigate', target, revision: 0 };
        this.disposables.push(this.navigationEmitter);
        this.updateMetadata(metadata);

        try {
            const { disposable } = attachTrpc(
                this.panel,
                this.buildRouterContext(),
                accountOverviewAppRouter,
                accountOverviewCallerFactory,
            );
            this.disposables.push(disposable);
            AccountOverviewTab.openTabs.add(this);
        } catch (error) {
            this.dispose();
            throw error;
        }
    }

    /**
     * Reuse one panel per account. Menu shortcuts select a tab or metric in the existing dashboard.
     */
    public static render(
        metadata: AzureResourceMetadata,
        viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active,
        target: AccountOverviewTarget = 'overview',
    ): AccountOverviewTab {
        if (!isAccountOverviewTarget(target)) {
            throw new Error(l10n.t('Invalid Account Overview destination.'));
        }
        const openTab = [...AccountOverviewTab.openTabs].find(
            (tab) => tab.metadata.accountId.toLowerCase() === metadata.accountId.toLowerCase(),
        );
        if (openTab) {
            openTab.initialization = { type: 'navigate', target, revision: openTab.initialization.revision + 1 };
            openTab.updateMetadata(metadata);
            openTab.panel.reveal(viewColumn);
            openTab.navigationEmitter.fire(openTab.initialization);
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

        return new AccountOverviewTab(panel, metadata, target);
    }

    public dispose(): void {
        AccountOverviewTab.openTabs.delete(this);
        super.dispose();
    }

    private buildRouterContext(): AccountOverviewRouterContext {
        const getMetadata = () => this.metadata;
        return {
            webviewName: AccountOverviewTab.viewType,
            get metadata() {
                return getMetadata();
            },
            getInitialization: () => this.initialization,
            onNavigation: this.navigationEmitter.event,
        };
    }

    private updateMetadata(metadata: AzureResourceMetadata): void {
        this.metadata = metadata;
        this.telemetryContext.addMaskedValue(getAccountOverviewMaskedValues(metadata));
        this.panel.title = `${AccountOverviewTab.title}: ${metadata.accountName}`;
    }
}
