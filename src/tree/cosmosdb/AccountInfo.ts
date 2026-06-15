/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { AzureResourceMetadata } from '../../cosmosdb/AzureResourceMetadata';
import { wellKnownEmulatorPassword } from '../../cosmosdb/cosmosdb-shared-constants';
import {
    parseCosmosDBConnectionString,
    type ParsedCosmosDBConnectionString,
} from '../../cosmosdb/cosmosDBConnectionStrings';
import { type CosmosDBCredential, getCosmosDBCredentials } from '../../cosmosdb/CosmosDBCredential';
import { FabricService } from '../../services/FabricService';
import { type FabricArtifact } from '../fabric/models/FabricArtifact';
import { type CosmosDBAttachedAccountModel } from '../workspace-view/cosmosdb/CosmosDBAttachedAccountModel';
import { type CosmosDBAccountModel } from './models/CosmosDBAccountModel';

export interface AccountInfo {
    /**
     * Azure metadata, populated only for Azure-signed-in accounts (i.e. accounts discovered via the Azure Resources view).
     * Required for ARM control-plane operations. Undefined for workspace-attached accounts and for the local emulator.
     */
    azureMetadata?: AzureResourceMetadata;
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
    accountOrConnectionString:
        | CosmosDBAccountModel
        | CosmosDBAttachedAccountModel
        | ParsedCosmosDBConnectionString
        | FabricArtifact,
): Promise<AccountInfo> | never {
    if (FabricService.isArtifact(accountOrConnectionString)) {
        const artifactConnectionInfo = await FabricService.getArtifactConnectionInfo(accountOrConnectionString);
        return artifactConnectionInfo.accountInfo;
    } else if (isCosmosDBAttachedAccountModel(accountOrConnectionString)) {
        return getAccountInfoForAttached(accountOrConnectionString);
    } else if (isCosmosDBConnectionString(accountOrConnectionString)) {
        return getAccountInfoForConnectionString(accountOrConnectionString);
    } else {
        return getAccountInfoForResource(accountOrConnectionString);
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
    const azureMetadata = await AzureResourceMetadata.create(account);
    if (!azureMetadata) {
        throw new Error(l10n.t('Failed to connect to Cosmos DB account'));
    }

    const credentials = await getCosmosDBCredentials({
        accountName: azureMetadata.accountName,
        documentEndpoint: azureMetadata.documentEndpoint,
        isEmulator: false,
        tenantId: azureMetadata.subscription.tenantId,

        arm: azureMetadata,
    });

    return {
        azureMetadata,
        credentials,
        endpoint: azureMetadata.documentEndpoint,
        id: azureMetadata.accountId,
        isEmulator: false,
        isServerless: azureMetadata.isServerless,
        name: azureMetadata.accountName,
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
