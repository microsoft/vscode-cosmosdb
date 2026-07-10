/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { createFeatureClient } from '../utils/azureClients';
import { type NoSqlQueryConnection } from './NoSqlQueryConnection';
import { isThroughputBucketsFeatureRegistered } from './throughputBucketsFeature';

const DOCUMENT_DB_PROVIDER = 'Microsoft.DocumentDB';
const THROUGHPUT_BUCKETS_FEATURE = 'ThroughputBuckets';

/**
 * Returns whether the Throughput Buckets preview is registered for the
 * subscription associated with a query-editor connection.
 *
 * Connections without Azure metadata cannot query subscription feature
 * registrations, so they fail closed rather than exposing a control whose
 * effect cannot be verified.
 */
export async function supportsThroughputBuckets(
    connection: NoSqlQueryConnection | undefined,
    context: IActionContext | undefined,
): Promise<boolean> {
    if (!connection || connection.isEmulator || !connection.azureMetadata || !context) {
        return false;
    }

    try {
        const client = await createFeatureClient(context, connection.azureMetadata.subscription);
        const feature = await client.features.get(DOCUMENT_DB_PROVIDER, THROUGHPUT_BUCKETS_FEATURE);
        return isThroughputBucketsFeatureRegistered(feature);
    } catch {
        // Capability detection is optional. If ARM is unavailable or the user
        // cannot read feature registrations, hide the selector rather than
        // presenting an option that may have no effect.
    }

    return false;
}
