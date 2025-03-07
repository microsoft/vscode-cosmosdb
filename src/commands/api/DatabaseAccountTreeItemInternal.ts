/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { API } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { type ParsedConnectionString } from '../../ParsedConnectionString';
import { ParsedPostgresConnectionString } from '../../postgres/postgresConnectionStrings';
import { PostgresServerTreeItem } from '../../postgres/tree/PostgresServerTreeItem';
import { type DatabaseAccountTreeItem } from '../../vscode-cosmosdb.api';

export class DatabaseAccountTreeItemInternal implements DatabaseAccountTreeItem {
    protected _parsedCS: ParsedConnectionString;
    private _accountNode: PostgresServerTreeItem | undefined;

    constructor(parsedCS: ParsedConnectionString, accountNode?: PostgresServerTreeItem) {
        this._parsedCS = parsedCS;
        this._accountNode = accountNode;
    }

    public get connectionString(): string {
        return this._parsedCS.connectionString;
    }

    public get hostName(): string {
        return this._parsedCS.hostName;
    }

    public get port(): string {
        return this._parsedCS.port;
    }

    public get azureData(): { accountName: string; accountId: string } | undefined {
        if (this._accountNode instanceof PostgresServerTreeItem) {
            if (this._accountNode.azureName) {
                return {
                    accountName: this._accountNode.azureName,
                    accountId: this._accountNode.fullId,
                };
            }
        }
        return undefined;
    }

    public get docDBData(): { masterKey: string; documentEndpoint: string } | undefined {
        return undefined;
    }

    public get postgresData(): { username: string | undefined; password: string | undefined } | undefined {
        if (this._parsedCS instanceof ParsedPostgresConnectionString) {
            const connectionString = this._parsedCS;
            return {
                username: connectionString.username,
                password: connectionString.password,
            };
        } else {
            return undefined;
        }
    }

    public async reveal(): Promise<void> {
        await callWithTelemetryAndErrorHandling('api.dbAccount.reveal', async (context: IActionContext) => {
            context.errorHandling.suppressDisplay = true;
            context.errorHandling.rethrow = true;
            await ext.rgApi.appResourceTreeView.reveal(await this.getAccountNode(context));
        });
    }

    protected async getAccountNode(context: IActionContext): Promise<PostgresServerTreeItem> {
        // If this._accountNode is undefined, attach a new node based on connection string
        if (!this._accountNode) {
            let apiType: API;
            if (this._parsedCS instanceof ParsedPostgresConnectionString) {
                apiType = API.PostgresSingle;
                this._accountNode = await ext.attachedAccountsNode.attachConnectionString(
                    context,
                    this.connectionString,
                    apiType,
                );
            } else {
                throw new Error(l10n.t('Unsupported connection string.'));
            }
        }

        return this._accountNode;
    }
}
