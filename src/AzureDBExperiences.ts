/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb/src/models';
import { type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import { type CosmosDBResource } from './tree/CosmosAccountModel';

export enum API {
    MongoDB = 'MongoDB',
    MongoClusters = 'MongoClusters',
    Graph = 'Graph',
    Table = 'Table',
    Cassandra = 'Cassandra',
    Core = 'Core', // Now called NoSQL
    PostgresSingle = 'PostgresSingle',
    PostgresFlexible = 'PostgresFlexible',
    Common = 'Common', // In case we're reporting a common event and still need to provide the value of the API
}

export enum DBAccountKind {
    MongoDB = 'MongoDB',
    GlobalDocumentDB = 'GlobalDocumentDB',
}

enum Capability {
    EnableGremlin = 'EnableGremlin',
    EnableTable = 'EnableTable',
    EnableCassandra = 'EnableCassandra',
}

enum Tag {
    Core = 'Core (SQL)',
    Mongo = 'Azure Cosmos DB for MongoDB API',
    Table = 'Azure Table',
    Gremlin = 'Gremlin (graph)',
    Cassandra = 'Cassandra',
}

export type CapabilityName = 'EnableGremlin' | 'EnableTable' | 'EnableCassandra';

export function getExperienceFromApi(api: API): Experience {
    let info = experiencesMap.get(api);
    if (!info) {
        info = { api: api, shortName: api, longName: api, kind: DBAccountKind.GlobalDocumentDB, tag: api };
    }
    return info;
}

export function tryGetExperience(resource: CosmosDBResource | DatabaseAccountGetResults): Experience | undefined {
    if (resource.kind === DBAccountKind.MongoDB) {
        return MongoExperience;
    }

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

export function getExperienceQuickPicks(): IAzureQuickPickItem<Experience>[] {
    return experiencesArray.map((exp) => getExperienceQuickPick(exp.api));
}

export function getCosmosExperienceQuickPicks(): IAzureQuickPickItem<Experience>[] {
    return cosmosExperiencesArray.map((exp) => getExperienceQuickPick(exp.api));
}

export function getPostgresExperienceQuickPicks(): IAzureQuickPickItem<Experience>[] {
    return postgresExperiencesArray.map((exp) => getExperienceQuickPick(exp.api));
}

export function getMongoCoreExperienceQuickPicks(): IAzureQuickPickItem<Experience>[] {
    return mongoCoreExperienceArray.map((exp) => getExperienceQuickPick(exp.api));
}

export function getExperienceQuickPick(api: API): IAzureQuickPickItem<Experience> {
    const exp = getExperienceFromApi(api);
    return { label: exp.longName, description: exp.description, data: exp };
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
export const MongoExperience: Experience = {
    api: API.MongoDB,
    longName: 'Cosmos DB for MongoDB',
    shortName: 'MongoDB',
    telemetryName: 'mongo',
    kind: DBAccountKind.MongoDB,
    tag: 'Azure Cosmos DB for MongoDB API',
} as const;
export const MongoClustersExperience: Experience = {
    api: API.MongoClusters,
    longName: 'Cosmos DB for MongoDB (vCore)',
    shortName: 'MongoDB (vCore)',
    telemetryName: 'mongoClusters',
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

const cosmosExperiencesArray: Experience[] = [CoreExperience, TableExperience, GremlinExperience];
const postgresExperiencesArray: Experience[] = [PostgresSingleExperience, PostgresFlexibleExperience];
const mongoCoreExperienceArray: Experience[] = [MongoClustersExperience];
const experiencesArray: Experience[] = [
    ...cosmosExperiencesArray,
    ...postgresExperiencesArray,
    ...mongoCoreExperienceArray,
];
const experiencesMap = new Map<API, Experience>(
    experiencesArray.map((info: Experience): [API, Experience] => [info.api, info]),
);
