/* ------------------------------------------------------------------------------------------
 *   Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseAccount } from 'azure-arm-cosmosdb/lib/models';
import { Server } from 'azure-arm-postgresql/lib/models';
import { IAzureQuickPickItem } from 'vscode-azureextensionui';

export enum API {
    MongoDB = 'MongoDB',
    Graph = 'Graph',
    Table = 'Table',
    Core = 'Core',
    Postgres = 'PostgreSQL'
}

export enum DBAccountKind {
    MongoDB = 'MongoDB',
    GlobalDocumentDB = 'GlobalDocumentDB',
    Postgres = 'PostgreSQL'
}

export type CapabilityName = 'EnableGremlin' | 'EnableTable';

export function getExperienceFromApi(api: API): Experience {
    let info = experiencesMap.get(api);
    if (!info) {
        info = { api: api, shortName: api, longName: api, kind: DBAccountKind.GlobalDocumentDB, tag: api };
    }
    return info;
}

export function getExperienceLabel(databaseAccount?: DatabaseAccount, server?: Server): string {
    let experience: Experience | undefined;
    let defaultExperience: string;
    let firstCapability;
    let firstCapabilityName;
    if (databaseAccount) {
        experience = tryGetExperience(databaseAccount);
        defaultExperience = <API>(databaseAccount && databaseAccount.tags && databaseAccount.tags.defaultExperience);
        if (experience) {
            return experience.shortName;
        }
        firstCapability = databaseAccount.capabilities && databaseAccount.capabilities[0];
        firstCapabilityName = firstCapability && firstCapability.name.replace(/^Enable/, '');

        return defaultExperience || firstCapabilityName || databaseAccount.kind;
    } else {
        experience = tryGetExperience(server);
        if (experience) {
            return experience.shortName;
        }
        defaultExperience = <API>(server && server.tags && server.tags.defaultExperience);
        return defaultExperience;
    }
}

export function tryGetExperience(databaseAccount?: DatabaseAccount, server?: Server): Experience | undefined {

    if (server) {
        return PostgresExperience;
    } else if (databaseAccount) {

        // defaultExperience in the account doesn't really mean anything, we can't depend on its value for determining account type
        if (databaseAccount.kind === DBAccountKind.MongoDB) {
            return MongoExperience;
        } else if (databaseAccount.capabilities.find(cap => cap.name === 'EnableGremlin')) {
            return GremlinExperience;
        } else if (databaseAccount.capabilities.find(cap => cap.name === 'EnableTable')) {
            return TableExperience;
        } else if (databaseAccount.capabilities.length === 0) {
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

    // These properties are what the portal actually looks at to determine the difference between APIs
    kind: DBAccountKind;
    capability?: CapabilityName;

    // The defaultExperience tag to place into the resource (has no actual effect in Azure, just imitating the portal)
    tag: string;
}

export function getExperienceQuickPicks(): IAzureQuickPickItem<Experience>[] {
    return experiencesArray.map(exp => getExperienceQuickPick(exp.api));
}

export function getExperienceQuickPick(api: API): IAzureQuickPickItem<Experience> {
    const exp = getExperienceFromApi(api);
    return { label: exp.longName, description: exp.description, data: exp };
}

// Mongo is distinguished by having kind="MongoDB". All others have kind="GlobalDocumentDB"
// Table and Gremlin are distinguished from SQL by their capabilities
const CoreExperience: Experience = { api: API.Core, longName: "Core", description: "(SQL)", shortName: "SQL", kind: DBAccountKind.GlobalDocumentDB, tag: "Core (SQL)" };
const MongoExperience: Experience = { api: API.MongoDB, longName: "Azure Cosmos DB for MongoDB API", shortName: "MongoDB", kind: DBAccountKind.MongoDB, tag: "Azure Cosmos DB for MongoDB API" };
const TableExperience: Experience = { api: API.Table, longName: "Azure Table", shortName: "Table", kind: DBAccountKind.GlobalDocumentDB, capability: 'EnableTable', tag: "Azure Table" };
const GremlinExperience: Experience = { api: API.Graph, longName: "Gremlin", description: "(graph)", shortName: "Gremlin", kind: DBAccountKind.GlobalDocumentDB, capability: 'EnableGremlin', tag: "Gremlin (graph)" };
const PostgresExperience: Experience = { api: API.Postgres, longName: "PostgreSQL", description: "PostgreSQL", shortName: "Postgres", kind: DBAccountKind.Postgres, tag: "Postgres" };

const experiencesArray: Experience[] = [CoreExperience, MongoExperience, TableExperience, GremlinExperience, PostgresExperience];
const experiencesMap = new Map<API, Experience>(experiencesArray.map((info: Experience): [API, Experience] => [info.api, info]));
