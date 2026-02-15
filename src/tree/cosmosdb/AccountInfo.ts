/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { SERVERLESS_CAPABILITY_NAME, wellKnownEmulatorPassword } from '../../constants';
import {
    parseCosmosDBConnectionString,
    type ParsedCosmosDBConnectionString,
} from '../../cosmosdb/cosmosDBConnectionStrings';
import { type CosmosDBCredential, getCosmosDBCredentials } from '../../cosmosdb/CosmosDBCredential';
import { createCosmosDBManagementClient } from '../../utils/azureClients';
import { nonNullProp } from '../../utils/nonNull';
import { type CosmosDBAttachedAccountModel } from '../workspace-view/cosmosdb/CosmosDBAttachedAccountModel';
import { type CosmosDBAccountModel } from './models/CosmosDBAccountModel';

export interface AccountInfo {
    credentials: CosmosDBCredential[];
    endpoint: string;
    id: string;
    isEmulator: boolean;
    isServerless: boolean;
    name: string;
}

function isCosmosDBAttachedAccountModel(account: unknown): account is CosmosDBAttachedAccountModel {
    return (
        !!account &&
        typeof account === 'object' &&
        'connectionString' in account &&
        'id' in account &&
        'isEmulator' in account &&
        'name' in account
    );
}

function isCosmosDBConnectionString(connectionString: unknown): connectionString is ParsedCosmosDBConnectionString {
    return !!connectionString && typeof connectionString === 'object' && 'documentEndpoint' in connectionString;
}

export async function getAccountInfo(
    accountOrConnectionString: CosmosDBAccountModel | CosmosDBAttachedAccountModel | ParsedCosmosDBConnectionString,
): Promise<AccountInfo> | never {
    if (isCosmosDBAttachedAccountModel(accountOrConnectionString)) {
        return getAccountInfoForAttached(accountOrConnectionString);
    } else if (isCosmosDBConnectionString(accountOrConnectionString)) {
        return getAccountInfoForConnectionString(accountOrConnectionString);
    } else {
        return getAccountInfoForResource(accountOrConnectionString as CosmosDBAccountModel);
    }
}

async function getAccountInfoForConnectionString(
    connectionString: ParsedCosmosDBConnectionString,
): Promise<AccountInfo> | never {
    const isEmulator = connectionString.masterKey === wellKnownEmulatorPassword;
    const credentials = await getCosmosDBCredentials({
        accountName: connectionString.accountName,
        documentEndpoint: connectionString.documentEndpoint,
        isEmulator,
        masterKey: connectionString.masterKey,
        tenantId: connectionString.tenantId,
    });
    const isServerless = false;

    return {
        credentials,
        endpoint: connectionString.documentEndpoint,
        id: connectionString.accountName,
        isEmulator,
        isServerless,
        name: connectionString.accountName,
    };
}

async function getAccountInfoForResource(account: CosmosDBAccountModel): Promise<AccountInfo> | never {
    const id = nonNullProp(account, 'id');
    const name = nonNullProp(account, 'name');
    const resourceGroup = nonNullProp(account, 'resourceGroup');

    const client = await callWithTelemetryAndErrorHandling(
        'createCosmosDBManagementClient',
        async (context: IActionContext) => {
            context.telemetry.suppressIfSuccessful = true;
            context.errorHandling.forceIncludeInReportIssueCommand = true;
            context.valuesToMask.push(account.subscription.subscriptionId);
            return createCosmosDBManagementClient(context, account.subscription);
        },
    );

    if (!client) {
        throw new Error(l10n.t('Failed to connect to Cosmos DB account'));
    }

    const databaseAccount = await client.databaseAccounts.get(resourceGroup, name);
    const tenantId = account?.subscription?.tenantId;
    const credentials = await getCosmosDBCredentials({
        accountName: name,
        documentEndpoint: nonNullProp(databaseAccount, 'documentEndpoint', `of the database account ${id}`),
        isEmulator: false,
        armClient: client,
        resourceGroup,
        databaseAccount,
        tenantId,
    });
    const documentEndpoint = nonNullProp(databaseAccount, 'documentEndpoint', `of the database account ${id}`);
    const isServerless = databaseAccount?.capabilities
        ? databaseAccount.capabilities.some((cap) => cap.name === SERVERLESS_CAPABILITY_NAME)
        : false;

    return {
        credentials,
        endpoint: documentEndpoint,
        id,
        isEmulator: false,
        isServerless,
        name,
    };
}

async function getAccountInfoForAttached(account: CosmosDBAttachedAccountModel): Promise<AccountInfo> | never {
    const id = account.id;
    const name = account.name;
    const isEmulator = account.isEmulator;
    const parsedCS = parseCosmosDBConnectionString(account.connectionString);
    const documentEndpoint = parsedCS.documentEndpoint;
    const tenantId = account.tenantId || parsedCS.tenantId;
    const credentials = await getCosmosDBCredentials({
        accountName: name,
        documentEndpoint,
        isEmulator,
        masterKey: parsedCS.masterKey,
        tenantId,
    });
    const isServerless = false;

    return {
        credentials,
        endpoint: documentEndpoint,
        id,
        isEmulator,
        isServerless,
        name,
    };
}
