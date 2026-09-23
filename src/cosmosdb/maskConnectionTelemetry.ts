/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { getCosmosDBKeyCredential } from './CosmosDBCredential';
import { type NoSqlQueryConnection } from './NoSqlQueryConnection';

/**
 * Register sensitive connection values for masking on this action; no file contents, paths, or names are emitted.
 */
export function maskConnectionTelemetry(
    context: Pick<IActionContext, 'valuesToMask'>,
    connection: NoSqlQueryConnection,
): void {
    const masterKey = getCosmosDBKeyCredential(connection.credentials)?.key ?? '';
    context.valuesToMask.push(
        ...[masterKey, connection.endpoint, connection.databaseId, connection.containerId].filter(
            (value) => value.trim().length > 0,
        ),
    );
}
