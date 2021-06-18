/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as FlexibleModels from "@azure/arm-postgresql-flexible/esm/models";
import * as SingleModels from "@azure/arm-postgresql/esm/models";
import { PostgresAbstractServer } from "./models";

export function asAbstractServer(server: FlexibleModels.Server | SingleModels.Server) : PostgresAbstractServer {
    return {
        id: server.id,
        name: server.name,
        fullyQualifiedDomainName: server.fullyQualifiedDomainName,
        version: server.version,
    }
}
