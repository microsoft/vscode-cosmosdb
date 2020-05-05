/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import PostgreSQLManagementClient from 'azure-arm-postgresql';
import { Client, ClientConfig } from 'pg';
import { ConnectionOptions } from 'tls';
import { AzExtTreeItem, AzureParentTreeItem, createAzureClient, GenericTreeItem, IParsedError, ISubscriptionContext, parseError, TreeItemIconPath } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { ext } from '../../extensionVariables';
import { azureUtils } from '../../utils/azureUtils';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { PostgresFunctionsTreeItem } from './PostgresFunctionsTreeItem';
import { PostgresServerTreeItem } from './PostgresServerTreeItem';
import { PostgresTablesTreeItem } from './PostgresTablesTreeItem';

const invalidCredentialsErrorType: string = '28P01';
const firewallNotConfiguredErrorType: string = '28000';

export class PostgresDatabaseTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresDatabase";
    public readonly contextValue: string = PostgresDatabaseTreeItem.contextValue;
    public readonly childTypeLabel: string = "Resource Type";
    public readonly databaseName: string;
    public readonly parent: PostgresServerTreeItem;
    public autoSelectInTreeItemPicker: boolean = true;
    public clientConfig: ClientConfig | undefined;

    constructor(parent: PostgresServerTreeItem, databaseName: string) {
        super(parent);
        this.databaseName = databaseName;
    }

    public get label(): string {
        return this.databaseName;
    }

    public get id(): string {
        return this.databaseName;
    }

    public get iconPath(): TreeItemIconPath {
        return getThemeAgnosticIconPath('Database.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {
        const { username, password } = await this.parent.getCredentials();

        if (username && password) {
            try {
                const ssl: ConnectionOptions = {
                    // Always provide the certificate since it is accepted even when SSL is disabled
                    // Certificate source: https://aka.ms/AA7wnvl
                    ca: BaltimoreCyberTrustRoot
                };

                const host: string = nonNullProp(this.parent.server, 'fullyQualifiedDomainName');
                const clientConfig: ClientConfig = { user: username, password, ssl, host, port: 5432, database: this.databaseName };

                // Ensure the client config is valid before continuing
                const client: Client = new Client(clientConfig);
                await client.connect();
                this.clientConfig = clientConfig;

                const functionsTreeItem = new PostgresFunctionsTreeItem(this, clientConfig);
                const tablesTreeItem = new PostgresTablesTreeItem(this, clientConfig);

                return [functionsTreeItem, tablesTreeItem];
            } catch (error) {
                const parsedError: IParsedError = parseError(error);

                if (parsedError.errorType === invalidCredentialsErrorType) {
                    // tslint:disable-next-line: no-floating-promises
                    ext.ui.showWarningMessage(localize('couldNotConnect', 'Could not connect to "{0}": {1}', this.parent.label, parsedError.message));
                } else if (parsedError.errorType === firewallNotConfiguredErrorType) {
                    const firewallTreeItem: AzExtTreeItem = new GenericTreeItem(this, {
                        contextValue: 'postgresFirewall',
                        label: localize('configureFirewall', 'Configure firewall to connect to "{0}"...', this.parent.label),
                        commandId: 'postgreSQL.configureFirewall'
                    });
                    firewallTreeItem.commandArgs = [this.parent];
                    return [firewallTreeItem];
                } else {
                    throw error;
                }
            }
        }

        const credentialsTreeItem: AzExtTreeItem = new GenericTreeItem(this, {
            contextValue: 'postgresCredentials',
            label: localize('enterCredentials', 'Enter server credentials to connect to "{0}"...', this.parent.label),
            commandId: 'postgreSQL.enterCredentials'
        });
        credentialsTreeItem.commandArgs = [this.parent];
        return [credentialsTreeItem];
    }

    public async deleteTreeItemImpl(): Promise<void> {
        const client: PostgreSQLManagementClient = createAzureClient(this.root, PostgreSQLManagementClient);
        await client.databases.deleteMethod(azureUtils.getResourceGroupFromId(this.fullId), this.parent.name, this.databaseName);
    }

    public addResourceAndSchemasEntry(resourceAndSchemas: { [key: string]: string[] }, name: string, schema: string): void {
        if (resourceAndSchemas[name]) {
            resourceAndSchemas[name].push(schema);
        } else {
            resourceAndSchemas[name] = [schema];
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
