/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, ClientConfig } from 'pg';
import pgStructure, { Db } from 'pg-structure';
import { ConnectionOptions } from 'tls';
import * as vscode from 'vscode';
import { AzExtTreeItem, AzureParentTreeItem, GenericTreeItem, IParsedError, ISubscriptionContext, parseError } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { ext } from '../../extensionVariables';
import { KeyTar, tryGetKeyTar } from '../../utils/keytar';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { PostgresSchemaTreeItem } from './PostgresSchemaTreeItem';
import { PostgresServerTreeItem } from './PostgresServerTreeItem';

interface IPersistedServer {
    id: string;
    username: string;
}
class CredentialsNotFoundError extends Error { }
const invalidCredentialsErrorType: string = '28P01';

export class PostgresDatabaseTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresDatabase";
    public readonly contextValue: string = PostgresDatabaseTreeItem.contextValue;
    public readonly childTypeLabel: string = "Schema";
    public readonly databaseName: string;
    public readonly parent: PostgresServerTreeItem;

    private readonly _serviceName: string = "ms-azuretools.vscode-cosmosdb.postgresPasswords";
    private _keytar: KeyTar | undefined;
    private _serverId: string;

    constructor(parent: PostgresServerTreeItem, databaseName: string) {
        super(parent);
        this.databaseName = databaseName;
        this._keytar = tryGetKeyTar();
        this._serverId = nonNullProp(this.parent.server, 'id');
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
            const { username, password } = await this.getCredentialsFromKeytar();

            const ssl: ConnectionOptions = {
                // Always provide the certificate since it is accepted even when SSL is disabled
                // Certificate source: https://aka.ms/AA7wnvl
                ca: BaltimoreCyberTrustRoot
            };

            const host: string = nonNullProp(this.parent.server, 'fullyQualifiedDomainName');
            const clientConfig: ClientConfig = { user: username, password, ssl, host, port: 5432, database: this.databaseName };
            const accountConnection: Client = new Client(clientConfig);
            const db: Db = await pgStructure(accountConnection);
            return db.schemas.map(schema => new PostgresSchemaTreeItem(this, schema));
        } catch (error) {
            const parsedError: IParsedError = parseError(error);

            if (parsedError.errorType === invalidCredentialsErrorType || parsedError.errorType === 'CredentialsNotFoundError') {
                if (parsedError.errorType === invalidCredentialsErrorType) {
                    // tslint:disable-next-line: no-floating-promises
                    ext.ui.showWarningMessage(localize('couldNotConnect', 'Could not connect to "{0}": {1}', this.parent.label, parsedError.message));
                }

                return [new GenericTreeItem(this, {
                    contextValue: 'postgresCredentials',
                    label: localize('enterCredentials', 'Enter server credentials to connect to "{0}"...', this.parent.label),
                    commandId: 'cosmosDB.getPostgresCredentials'
                })];
            }

            throw error;
        }
    }

    public async promptForCredentials(): Promise<{ username: string, password: string }> {
        let username: string = await ext.ui.showInputBox({
            prompt: localize('enterUsername', 'Enter username for server "{0}"', this.parent.label),
            validateInput: (value: string) => { return (value && value.length) ? undefined : localize('usernameCannotBeEmpty', 'Username cannot be empty.'); }
        });

        const usernameSuffix: string = `@${this.parent.server.name}`;
        if (!username.includes(usernameSuffix)) {
            username += usernameSuffix;
        }

        const password: string = await ext.ui.showInputBox({
            prompt: localize('enterPassword', 'Enter password for server "{0}"', this.parent.label),
            password: true,
            validateInput: (value: string) => { return (value && value.length) ? undefined : localize('passwordCannotBeEmpty', 'Password cannot be empty.'); }
        });

        await this.persistServer(username, password);
        return { username, password };
    }

    private async getCredentialsFromKeytar(): Promise<{ username: string, password: string }> {
        const storedValue: string | undefined = ext.context.globalState.get(this._serviceName);
        if (storedValue && this._keytar) {
            const servers: IPersistedServer[] = JSON.parse(storedValue);
            for (const server of servers) {
                if (server.id === this._serverId) {
                    return {
                        username: server.username,
                        password: <string>await this._keytar.getPassword(this._serviceName, this._serverId)
                    };
                }
            }
        }

        throw new CredentialsNotFoundError();
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

const BaltimoreCyberTrustRoot: string = `-----BEGIN CERTIFICATE-----
MIIDdzCCAl+gAwIBAgIEAgAAuTANBgkqhkiG9w0BAQUFADBaMQswCQYDVQQGEwJJ
RTESMBAGA1UEChMJQmFsdGltb3JlMRMwEQYDVQQLEwpDeWJlclRydXN0MSIwIAYD
VQQDExlCYWx0aW1vcmUgQ3liZXJUcnVzdCBSb290MB4XDTAwMDUxMjE4NDYwMFoX
DTI1MDUxMjIzNTkwMFowWjELMAkGA1UEBhMCSUUxEjAQBgNVBAoTCUJhbHRpbW9y
ZTETMBEGA1UECxMKQ3liZXJUcnVzdDEiMCAGA1UEAxMZQmFsdGltb3JlIEN5YmVy
VHJ1c3QgUm9vdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAKMEuyKr
mD1X6CZymrV51Cni4eiVgLGw41uOKymaZN+hXe2wCQVt2yguzmKiYv60iNoS6zjr
IZ3AQSsBUnuId9Mcj8e6uYi1agnnc+gRQKfRzMpijS3ljwumUNKoUMMo6vWrJYeK
mpYcqWe4PwzV9/lSEy/CG9VwcPCPwBLKBsua4dnKM3p31vjsufFoREJIE9LAwqSu
XmD+tqYF/LTdB1kC1FkYmGP1pWPgkAx9XbIGevOF6uvUA65ehD5f/xXtabz5OTZy
dc93Uk3zyZAsuT3lySNTPx8kmCFcB5kpvcY67Oduhjprl3RjM71oGDHweI12v/ye
jl0qhqdNkNwnGjkCAwEAAaNFMEMwHQYDVR0OBBYEFOWdWTCCR1jMrPoIVDaGezq1
BE3wMBIGA1UdEwEB/wQIMAYBAf8CAQMwDgYDVR0PAQH/BAQDAgEGMA0GCSqGSIb3
DQEBBQUAA4IBAQCFDF2O5G9RaEIFoN27TyclhAO992T9Ldcw46QQF+vaKSm2eT92
9hkTI7gQCvlYpNRhcL0EYWoSihfVCr3FvDB81ukMJY2GQE/szKN+OMY3EU/t3Wgx
jkzSswF07r51XgdIGn9w/xZchMB5hbgF/X++ZRGjD8ACtPhSNzkE1akxehi/oCr0
Epn3o0WC4zxe9Z2etciefC7IpJ5OCBRLbf1wbWsaY71k5h+3zvDyny67G7fyUIhz
ksLi4xaNmjICq44Y3ekQEe5+NauQrz4wlHrQMz2nZQ/1/I6eYs9HRCwBXbsdtTLS
R9I4LtD+gdwyah617jzV/OeBHRnDJELqYzmp
-----END CERTIFICATE-----`;
