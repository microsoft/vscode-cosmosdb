/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureResourceMetadata } from '../../cosmosdb/AzureResourceMetadata';

/** Error-path masking only; no resource identities are emitted as telemetry properties. */
export function getAccountOverviewMaskedValues(metadata: AzureResourceMetadata): string[] {
    return getResourceMaskedValues([
        metadata.accountId,
        metadata.accountName,
        metadata.resourceGroup,
        metadata.documentEndpoint,
        metadata.subscription.subscriptionId,
        metadata.subscription.name,
        metadata.databaseAccount.id,
        metadata.databaseAccount.name,
        metadata.databaseAccount.location,
        ...(metadata.databaseAccount.readLocations ?? []).flatMap((location) => [
            location.id,
            location.locationName,
            location.documentEndpoint,
        ]),
        ...(metadata.databaseAccount.writeLocations ?? []).flatMap((location) => [
            location.id,
            location.locationName,
            location.documentEndpoint,
        ]),
    ]);
}

/** Mask raw values and their SDK error-path representations; nothing is emitted as telemetry properties. */
export function getResourceMaskedValues(values: readonly unknown[]): string[] {
    const masked = new Set<string>();
    const add = (value: string) => {
        if (!value.trim()) {
            return;
        }
        for (const representation of [value, value.replace(/'/g, "''")]) {
            masked.add(representation);
            // encodeURIComponent rejects lone surrogates, which can occur in invalid RPC input.
            const encoded = encodeURIComponent(representation.toWellFormed());
            masked.add(encoded);
            masked.add(encoded.replace(/'/g, '%27'));
        }
    };
    for (const value of values) {
        if (typeof value !== 'string' || !value.trim()) {
            continue;
        }
        add(value);
        for (const match of value.matchAll(
            /\/(?:subscriptions|resourceGroups|databaseAccounts|sqlDatabases|sqlContainers|mongodbDatabases|collections|locations)\/([^/]+)/gi,
        )) {
            add(match[1]);
            try {
                add(decodeURIComponent(match[1]));
            } catch {
                // Malformed percent escapes still have their original value masked.
            }
        }
        if (/^https?:\/\//i.test(value)) {
            try {
                const endpoint = new URL(value);
                add(endpoint.host);
                add(endpoint.hostname);
                add(endpoint.origin);
            } catch {
                // Invalid endpoints still have their original value masked.
            }
        }
    }
    return [...masked];
}
