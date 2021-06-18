/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as FlexibleModels from "@azure/arm-postgresql-flexible/esm/models";
import * as SingleModels from "@azure/arm-postgresql/esm/models";
import { PostgresAbstractDatabase, PostgresAbstractServer, PostgresServerType } from "./models";



export function singleAsAbstractServer(server: SingleModels.Server) : PostgresAbstractServer {
    return {
        id: server.id,
        name: server.name,
        fullyQualifiedDomainName: server.fullyQualifiedDomainName,
        version: server.version,
        serverType: PostgresServerType.Single
    }
}


export function flexibleAsAbstractServer(server: FlexibleModels.Server) : PostgresAbstractServer {
    return {
        id: server.id,
        name: server.name,
        fullyQualifiedDomainName: server.fullyQualifiedDomainName,
        version: server.version,
        serverType: PostgresServerType.Flexible
    }
}

export function asAbstractDatabase(db: FlexibleModels.Database | SingleModels.Database) : PostgresAbstractDatabase {
    return {
        id: db.id,
        name: db.name,
    }
}
