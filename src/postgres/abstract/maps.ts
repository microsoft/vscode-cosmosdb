/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as FlexibleModels from "@azure/arm-postgresql-flexible/esm/models";
import * as SingleModels from "@azure/arm-postgresql/esm/models";
import { AbstractServerCreate, PostgresAbstractDatabase, PostgresAbstractServer, PostgresServerType } from "./models";



export function singleAsAbstractServer(server: SingleModels.Server) : PostgresAbstractServer {
    return {
        id: server.id,
        name: server.name,
        type: server.type,
        tags: server.tags,
        location: server.location,
        identity: server.identity,
        fullyQualifiedDomainName: server.fullyQualifiedDomainName,
        version: server.version,
        serverType: PostgresServerType.Single
    }
}


export function flexibleAsAbstractServer(server: FlexibleModels.Server) : PostgresAbstractServer {
    return {
        id: server.id,
        name: server.name,
        type: server.type,
        tags: server.tags,
        location: server.location,
        identity: server.identity,
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

export function asFlexibleParameters(parameters: AbstractServerCreate) : FlexibleModels.Server {
    return {
        location: parameters.location,
        version: parameters.version as FlexibleModels.ServerVersion,
        administratorLogin: parameters.administratorLogin,
        administratorLoginPassword: parameters.administratorLoginPassword,
        storageProfile: {
            storageMB: parameters.storageMB
        },
        sku: {
            name: parameters.sku.name,
            tier: parameters.sku.tier as FlexibleModels.SkuTier
        },
    }
}

export function asSingleParameters(parameters: AbstractServerCreate) : SingleModels.ServerForCreate {
    return {
        location: parameters.location,
        sku: {
            name: parameters.sku.name,
            capacity: parameters.sku.capacity,
            size: parameters.sku.size,
            family: parameters.sku.family,
            tier: parameters.sku.tier as SingleModels.SkuTier
        },
        properties: {
            administratorLogin: parameters.administratorLogin,
            administratorLoginPassword: parameters.administratorLoginPassword,
            sslEnforcement: "Enabled",
            createMode: "Default",
            version: parameters.version as SingleModels.ServerVersion,
            storageProfile: {
                storageMB: parameters.storageMB
            }
        }
    }
}
