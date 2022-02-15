/* ------------------------------------------------------------------------------------------
 *   Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseAccountGetResults } from '@azure/arm-cosmosdb/src/models';
import { IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import { nonNullProp } from './utils/nonNull';

export enum API {
    MongoDB = 'MongoDB',
    Graph = 'Graph',
    Table = 'Table',
    Core = 'Core',
    PostgresSingle = 'PostgresSingle',
    PostgresFlexible = 'PostgresFlexible'
}

export enum DBAccountKind {
    MongoDB = 'MongoDB',
    GlobalDocumentDB = 'GlobalDocumentDB'
}

export type CapabilityName = 'EnableGremlin' | 'EnableTable';

export function getExperienceFromApi(api: API): Experience {
    let info = experiencesMap.get(api);
    if (!info) {
        info = { api: api, shortName: api, longName: api, kind: DBAccountKind.GlobalDocumentDB, tag: api };
    }
    return info;
}

export function getExperienceLabel(databaseAccount: DatabaseAccountGetResults): string {

    const experience: Experience | undefined = tryGetExperience(databaseAccount);
    if (experience) {
        return experience.shortName;
    }
    // Must be some new kind of resource that we aren't aware of.  Try to get a decent label
    const defaultExperience: string = <API>(databaseAccount && databaseAccount.tags && databaseAccount.tags.defaultExperience);
    const firstCapability = databaseAccount.capabilities && databaseAccount.capabilities[0];
    const firstCapabilityName = firstCapability?.name?.replace(/^Enable/, '');
    return defaultExperience || firstCapabilityName || nonNullProp(databaseAccount, 'kind');

}

export function tryGetExperience(resource: DatabaseAccountGetResults): Experience | undefined {
    // defaultExperience in the resource doesn't really mean anything, we can't depend on its value for determining resource type
    if (resource.kind === DBAccountKind.MongoDB) {
        return MongoExperience;
    } else if (resource.capabilities?.find(cap => cap.name === 'EnableGremlin')) {
        return GremlinExperience;
    } else if (resource.capabilities?.find(cap => cap.name === 'EnableTable')) {
        return TableExperience;
    } else if (resource.capabilities?.length === 0) {
        return CoreExperience;
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

    // These properties are what the portal actually looks at to determine the difference between APIs
    kind?: DBAccountKind;
    capability?: CapabilityName;

    // The defaultExperience tag to place into the resource (has no actual effect in Azure, just imitating the portal)
    tag?: string;
}

export function getExperienceQuickPicks(attached?: boolean): IAzureQuickPickItem<Experience>[] {
    if (attached) {
        return experiencesArray.map(exp => getExperienceQuickPickForAttached(exp.api));
    } else {
        return experiencesArray.map(exp => getExperienceQuickPick(exp.api));
    }
}

export function getCosmosExperienceQuickPicks(attached?: boolean): IAzureQuickPickItem<Experience>[] {
    if (attached) {
        return cosmosExperiencesArray.map(exp => getExperienceQuickPickForAttached(exp.api));
    } else {
        return cosmosExperiencesArray.map(exp => getExperienceQuickPick(exp.api));
    }
}

export function getExperienceQuickPick(api: API): IAzureQuickPickItem<Experience> {
    const exp = getExperienceFromApi(api);
    return { label: exp.longName, description: exp.description, data: exp };
}

export function getExperienceQuickPickForAttached(api: API): IAzureQuickPickItem<Experience> {
    const exp = getExperienceFromApi(api);
    return { label: exp.shortName, description: exp.description, data: exp };
}

// Mongo is distinguished by having kind="MongoDB". All others have kind="GlobalDocumentDB"
// Table and Gremlin are distinguished from SQL by their capabilities
const CoreExperience: Experience = { api: API.Core, longName: "Core", description: "(SQL)", shortName: "SQL", kind: DBAccountKind.GlobalDocumentDB, tag: "Core (SQL)" };
export const MongoExperience: Experience = { api: API.MongoDB, longName: "Azure Cosmos DB for MongoDB API", shortName: "MongoDB", kind: DBAccountKind.MongoDB, tag: "Azure Cosmos DB for MongoDB API" };
const TableExperience: Experience = { api: API.Table, longName: "Azure Table", shortName: "Table", kind: DBAccountKind.GlobalDocumentDB, capability: 'EnableTable', tag: "Azure Table" };
const GremlinExperience: Experience = { api: API.Graph, longName: "Gremlin", description: "(graph)", shortName: "Gremlin", kind: DBAccountKind.GlobalDocumentDB, capability: 'EnableGremlin', tag: "Gremlin (graph)" };
const PostgresSingleExperience: Experience = { api: API.PostgresSingle, longName: "PostgreSQL Single Server", shortName: "PostgreSQLSingle" };
const PostgresFlexibleExperience: Experience = { api: API.PostgresFlexible, longName: "PostgreSQL Flexible Server (Preview)", shortName: "PostgreSQLFlexible" };

const cosmosExperiencesArray: Experience[] = [CoreExperience, MongoExperience, TableExperience, GremlinExperience];
const experiencesArray: Experience[] = [...cosmosExperiencesArray, PostgresSingleExperience, PostgresFlexibleExperience];
const experiencesMap = new Map<API, Experience>(experiencesArray.map((info: Experience): [API, Experience] => [info.api, info]));
