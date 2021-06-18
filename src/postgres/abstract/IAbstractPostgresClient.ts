/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Models from './models';

export interface IAbstractPostgresClient {
    listDatabases(serverType: Models.PostgresServerType, resourceGroup: string, name: string): Promise<Models.PostgresAbstractDatabaseList>;
    listServers(): Promise<Models.PostgresAbstractServerList>;
}
