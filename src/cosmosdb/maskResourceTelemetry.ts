/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AuthenticationMethod } from './AuthenticationMethod';
import { type CosmosDBCredential } from './CosmosDBCredential';
import { maskConnectionTelemetry } from './maskConnectionTelemetry';

type MaskingContext = Pick<IActionContext, 'valuesToMask'>;

/** Registers ARM identifiers on this action only. No names or identifiers are emitted. */
export function maskAzureResourceTelemetry(
    context: MaskingContext,
    resource: {
        resourceId?: string;
        subscriptionId?: string;
        resourceGroup?: string;
        accountName?: string;
    },
): void {
    addMasks(context, [resource.resourceId, resource.subscriptionId, resource.resourceGroup, resource.accountName]);
}

/** Reads only already-available tree model values, without loading metadata or credentials. Nothing is emitted. */
export function maskTreeElementTelemetry(context: MaskingContext, element: unknown): void {
    const node = objectValue(element);
    const account = objectValue(node?.account);
    const model = objectValue(node?.model);
    const accountInfo = objectValue(model?.accountInfo);
    const metadata = objectValue(accountInfo?.azureMetadata);
    const subscription = objectValue(account?.subscription);
    const metadataSubscription = objectValue(metadata?.subscription);
    const database = objectValue(model?.database);
    const container = objectValue(model?.container);
    const credentials = Array.isArray(accountInfo?.credentials)
        ? accountInfo.credentials.filter(isCredential)
        : undefined;

    maskConnectionTelemetry(context, {
        endpoint: stringValue(accountInfo?.endpoint),
        databaseId: stringValue(database?.id),
        containerId: stringValue(container?.id),
        credentials,
    });
    addMasks(context, [
        node?.id,
        account?.id,
        account?.name,
        account?.resourceGroup,
        subscription?.subscriptionId,
        account?.connectionString,
        account?.documentEndpoint,
        accountInfo?.id,
        accountInfo?.name,
        metadata?.accountId,
        metadata?.accountName,
        metadata?.resourceGroup,
        metadataSubscription?.subscriptionId,
        objectValue(model?.item)?.id,
        objectValue(model?.procedure)?.id,
        objectValue(model?.trigger)?.id,
    ]);
    if (typeof account?.connectionString === 'string') {
        for (const part of account.connectionString.split(';')) {
            const match = part.match(/^\s*(?:AccountEndpoint|AccountKey|Database)\s*=(.*)$/i);
            addMasks(context, [match?.[1]]);
        }
    }
}

function addMasks(context: MaskingContext, values: unknown[]): void {
    context.valuesToMask.push(
        ...values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    );
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function isCredential(value: unknown): value is CosmosDBCredential {
    const credential = objectValue(value);
    switch (credential?.type) {
        case AuthenticationMethod.accountKey:
            return typeof credential.key === 'string';
        case AuthenticationMethod.entraId:
            return credential.tenantId === undefined || typeof credential.tenantId === 'string';
        case AuthenticationMethod.managedIdentity:
            return credential.clientId === undefined || typeof credential.clientId === 'string';
        default:
            return false;
    }
}
