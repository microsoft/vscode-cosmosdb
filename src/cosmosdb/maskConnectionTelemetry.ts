/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AuthenticationMethod } from './AuthenticationMethod';
import { type NoSqlQueryConnection } from './NoSqlQueryConnection';

/**
 * Register connection values and all credential keys/identifiers for masking on this action.
 * No file contents, paths, or names are emitted.
 */
export function maskConnectionTelemetry(
    context: Pick<IActionContext, 'valuesToMask'>,
    connection: NoSqlQueryConnection,
): void {
    const credentialValues = connection.credentials.map((credential) => {
        switch (credential.type) {
            case AuthenticationMethod.accountKey:
                return credential.key;
            case AuthenticationMethod.entraId:
                return credential.tenantId;
            case AuthenticationMethod.managedIdentity:
                return credential.clientId;
        }
    });
    context.valuesToMask.push(
        ...[...credentialValues, connection.endpoint, connection.databaseId, connection.containerId].filter(
            (value): value is string => value !== undefined && value.trim().length > 0,
        ),
    );
}
