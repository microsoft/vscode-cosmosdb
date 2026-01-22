/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { type CosmosDBAccountModel } from './tree/cosmosdb/models/CosmosDBAccountModel';

export enum API {
    Core = 'Core', // Now called NoSQL
    Common = 'Common', // In case we're reporting a common event and still need to provide the value of the API
    /** @deprecated Graph API is retired */
    Graph = 'Graph',
    /** @deprecated Table API is retired */
    Table = 'Table',
    /** @deprecated Cassandra API is retired */
    Cassandra = 'Cassandra',
    /** @deprecated PostgresSingle API is not supported in this extension */
    PostgresSingle = 'PostgresSingle',
    /** @deprecated PostgresFlexible API is not supported in this extension */
    PostgresFlexible = 'PostgresFlexible',
}

export enum DBAccountKind {
    GlobalDocumentDB = 'GlobalDocumentDB',
}

enum Capability {
    EnableGremlin = 'EnableGremlin',
    EnableTable = 'EnableTable',
    EnableCassandra = 'EnableCassandra',
}

enum Tag {
    Core = 'Core (SQL)',
    Table = 'Azure Table',
    Gremlin = 'Gremlin (graph)',
    Cassandra = 'Cassandra',
}

export type CapabilityName = keyof typeof Capability;

export function getExperienceFromApi(api: API): Experience {
    let info = experiencesMap.get(api);
    if (!info) {
        info = { api: api, shortName: api, longName: api, kind: DBAccountKind.GlobalDocumentDB, tag: api };
    }
    return info;
}

export function tryGetExperience(resource: CosmosDBAccountModel | DatabaseAccountGetResults): Experience | undefined {
    if ('capabilities' in resource) {
        // defaultExperience in the resource doesn't really mean anything, we can't depend on its value for determining resource type
        if (resource.capabilities?.find((cap) => cap.name === Capability.EnableGremlin)) {
            return GremlinExperience;
        } else if (resource.capabilities?.find((cap) => cap.name === Capability.EnableTable)) {
            return TableExperience;
        } else if (resource.capabilities?.find((cap) => cap.name === Capability.EnableCassandra)) {
            return CassandraExperience;
        } else if (resource.capabilities?.length === 0) {
            return CoreExperience;
        }
    } else if ('tags' in resource) {
        if (resource.tags?.defaultExperience === Tag.Gremlin) {
            return GremlinExperience;
        } else if (resource.tags?.defaultExperience === Tag.Table) {
            return TableExperience;
        } else if (resource.tags?.defaultExperience === Tag.Cassandra) {
            return CassandraExperience;
        } else if (resource.tags?.defaultExperience === Tag.Core) {
            return CoreExperience;
        }
    }

    // Fallback to using 'kind' if capabilities/tags are not present
    // Usually all newly created accounts used to have tags or capabilities,
    // now newly created Serverless accounts lack the "Core (SQL)" tag as well as capabilities
    // Let's just rely on 'kind' in that case and assume all non-SQL accounts still have capabilities/tags
    if ('kind' in resource) {
        if (resource.kind === DBAccountKind.GlobalDocumentDB) {
            return CoreExperience;
        }
    }

    return undefined;
}

export interface Experience {
    /**
     * Programmatic name used internally by us for historical reasons. Doesn't actually affect anything in Azure (maybe UI?)
     */
    api: API;

    longName: string;
    shortName: string;
    description?: string;

    // the string used as a telemetry key for a given experience
    telemetryName?: string;

    // These properties are what the portal actually looks at to determine the difference between APIs
    kind?: DBAccountKind;
    capability?: CapabilityName;

    // The defaultExperience tag to place into the resource (has no actual effect in Azure, just imitating the portal)
    tag?: string;
}

// Mongo is distinguished by having kind="MongoDB". All others have kind="GlobalDocumentDB"
// Table and Gremlin are distinguished from SQL by their capabilities
// Tags reflect the defaultExperience tag in the portal and should not be changed unless they are changed in the portal
export const CoreExperience: Experience = {
    api: API.Core,
    longName: 'Cosmos DB for NoSQL',
    shortName: 'NoSQL',
    kind: DBAccountKind.GlobalDocumentDB,
    tag: 'Core (SQL)',
} as const;
export const TableExperience: Experience = {
    api: API.Table,
    longName: 'Cosmos DB for Table',
    shortName: 'Table',
    kind: DBAccountKind.GlobalDocumentDB,
    capability: 'EnableTable',
    tag: 'Azure Table',
} as const;
export const GremlinExperience: Experience = {
    api: API.Graph,
    longName: 'Cosmos DB for Gremlin',
    description: '(Graph)',
    shortName: 'Gremlin',
    kind: DBAccountKind.GlobalDocumentDB,
    capability: 'EnableGremlin',
    tag: 'Gremlin (graph)',
} as const;
export const CassandraExperience: Experience = {
    api: API.Cassandra,
    longName: 'Cosmos DB for Cassandra',
    shortName: 'Cassandra',
    kind: DBAccountKind.GlobalDocumentDB,
    capability: 'EnableCassandra',
    tag: 'Cassandra',
};
export const PostgresSingleExperience: Experience = {
    api: API.PostgresSingle,
    longName: 'PostgreSQL Single Server',
    shortName: 'PostgreSQLSingle',
};
export const PostgresFlexibleExperience: Experience = {
    api: API.PostgresFlexible,
    longName: 'PostgreSQL Flexible Server',
    shortName: 'PostgreSQLFlexible',
};

const experiencesArray: Experience[] = [
    CoreExperience,
    TableExperience,
    GremlinExperience,
    CassandraExperience,
    PostgresSingleExperience,
    PostgresFlexibleExperience,
];
const experiencesMap = new Map<API, Experience>(
    experiencesArray.map((info: Experience): [API, Experience] => [info.api, info]),
);
