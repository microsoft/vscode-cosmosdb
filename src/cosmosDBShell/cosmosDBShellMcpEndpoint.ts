/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const CosmosDBShellMcpHost = '127.0.0.1';

export function getCosmosDBShellMcpEndpoint(port: string): string {
    return `http://${CosmosDBShellMcpHost}:${port}`;
}
