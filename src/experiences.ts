/* ------------------------------------------------------------------------------------------
 *   Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

export function getExperienceLabel(account?: any): string {
    let experience: Experience | undefined = tryGetExperience(account);
    experience = tryGetExperience(account);

    if (experience) {
        return experience.shortName;
    }

    const defaultExperience: string = <API>(account && account.tags && account.tags.defaultExperience);
    let firstCapability;
    let firstCapabilityName;

    // Must be some new kind of account that we aren't aware of.  Try to get a decent label
    if (account.type !== "Microsoft.DBforPostgreSQL/servers") {

        firstCapability = account.capabilities && account.capabilities[0];
        firstCapabilityName = firstCapability && firstCapability.name.replace(/^Enable/, '');
    }

    return defaultExperience || firstCapabilityName || account.kind;
}

export function tryGetExperience(account?: any): Experience | undefined {

    if (account && account.type === "Microsoft.DBforPostgreSQL/servers") {

        return PostgresExperience;
    } else if (account) {

        // defaultExperience in the account doesn't really mean anything, we can't depend on its value for determining account type
        if (account.kind === DBAccountKind.MongoDB) {
            return MongoExperience;
        } else if (account.capabilities.find(cap => cap.name === 'EnableGremlin')) {
            return GremlinExperience;
        } else if (account.capabilities.find(cap => cap.name === 'EnableTable')) {
            return TableExperience;
        } else if (account.capabilities.length === 0) {
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
