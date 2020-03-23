/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, ClientConfig } from 'pg';
import pgStructure, { Db } from 'pg-structure';
import * as vscode from 'vscode';
import { AzExtTreeItem, AzureParentTreeItem, IParsedError, ISubscriptionContext, parseError } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { ext } from '../../extensionVariables';
import { KeyTar, tryGetKeyTar } from '../../utils/keytar';
import { localize } from '../../utils/localize';
import { PostgresEnterCredentialsTreeItem } from './PostgresEnterCredentialsTreeItem';
import { PostgresSchemaTreeItem } from './PostgresSchemaTreeItem';
import { PostgresServerTreeItem } from './PostgresServerTreeItem';

interface IPersistedServer {
    id: string;
    username: string;
}

export class PostgresDatabaseTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresDatabase";
    public readonly contextValue: string = PostgresDatabaseTreeItem.contextValue;
    public readonly childTypeLabel: string = "Schema";
    public readonly databaseName: string;
    public readonly parent: PostgresServerTreeItem;

    private readonly _serviceName: string = "ms-azuretools.vscode-cosmosdb.postgresPasswords";
    private _keytar: KeyTar;
    private _usernameSuffix: string;
    private _usernamePlaceholder: string;
    private _usernameRegex: RegExp;
    private _serverId: string;

    constructor(parent: PostgresServerTreeItem, databaseName: string) {
        super(parent);
        this.databaseName = databaseName;
        this._keytar = tryGetKeyTar();
        this._usernameSuffix = `@${this.parent.server.name}`;
        this._usernamePlaceholder = `user${this._usernameSuffix}`;
        this._usernameRegex = new RegExp(`(.+)${this._usernameSuffix}`);
        this._serverId = this.parent.server.id;
    }

    public get label(): string {
        return this.databaseName;
    }

    public get id(): string {
        return this.databaseName;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('Database.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {
        try {
            const { username, password } = await this.getCredentials(false, true);

            const sslString: string = process.env.POSTGRES_SSL;
            const ssl: boolean = sslString === 'true';
            const host: string = this.parent.server.fullyQualifiedDomainName;
            const clientConfig: ClientConfig = { user: username, password, ssl, host, port: 5432, database: this.databaseName };
            const accountConnection: Client = new Client(clientConfig);
            const db: Db = await pgStructure(accountConnection);
            return db.schemas.map(schema => new PostgresSchemaTreeItem(this, schema));
        } catch (error) {
            const parsedError: IParsedError = parseError(error);

            if (parsedError.errorType !== 'UserCancelledError') {
                // tslint:disable-next-line: no-floating-promises
                ext.ui.showWarningMessage(localize('couldNotConnect', 'Could not connect to "{0}": {1}', this.parent.label, parsedError.message));
            }

            return [new PostgresEnterCredentialsTreeItem(this)];
        }
    }

    public async getCredentials(forcePrompt: boolean, warnBeforePrompting: boolean): Promise<{ username: string, password: string }> {
        let username: string | undefined;
        let password: string | undefined;

        if (!forcePrompt) {
            const storedValue: string | undefined = ext.context.globalState.get(this._serviceName);
            if (storedValue && this._keytar) {
                const servers: IPersistedServer[] = JSON.parse(storedValue);
                for (const server of servers) {
                    if (server.id === this._serverId) {
                        username = server.username;
                        password = await this._keytar.getPassword(this._serviceName, this._serverId);
                        break;
                    }
                }
            }
        }

        if (!username || !password) {
            if (warnBeforePrompting) {
                await ext.ui.showWarningMessage(
                    localize('mustEnterUsernameAndPassword', 'You must enter the username and password for server "{0}" to continue.', this.parent.label),
                    { modal: true },
                    { title: localize('continue', 'Continue') }
                );
            }

            username = await ext.ui.showInputBox({
                prompt: localize('enterUsername', 'Enter username for server "{0}"', this.parent.label),
                placeHolder: this._usernamePlaceholder,
                validateInput: (value: string) => this.validateUsername(value)
            });

            password = await ext.ui.showInputBox({
                prompt: localize('enterPassword', 'Enter password for server "{0}"', this.parent.label),
                password: true,
                validateInput: (value: string) => { return (value && value.length) ? undefined : localize('passwordCannotBeEmpty', 'Password cannot be empty.'); }
            });

            await this.persistServer(username, password);
        }

        return { username, password };
    }

    private validateUsername(value: string): string | undefined {
        value = value ? value.trim() : '';

        if (!value) {
            return localize('usernameCannotBeEmpty', 'Username cannot be empty.');
        }

        if (!this._usernameRegex.test(value)) {
            return localize('usernameMustMatchFormat', 'Username must match format "{0}"', this._usernamePlaceholder);
        }

        return undefined;
    }

    private async persistServer(username: string, password: string): Promise<void> {
        if (this._keytar) {
            const storedValue: string | undefined = ext.context.globalState.get(this._serviceName);
            let servers: IPersistedServer[] = storedValue ? JSON.parse(storedValue) : [];

            // Remove this server from the cache if it's there
            servers = servers.filter((server: IPersistedServer) => { return server.id !== this._serverId; });

            const newServer: IPersistedServer = {
                id: this._serverId,
                username
            };
            servers.push(newServer);
            await ext.context.globalState.update(this._serviceName, JSON.stringify(servers));
            await this._keytar.setPassword(this._serviceName, this._serverId, password);
        }
    }
}
