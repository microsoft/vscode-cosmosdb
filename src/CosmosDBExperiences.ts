/* ------------------------------------------------------------------------------------------
 *   Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseAccount } from 'azure-arm-cosmosdb/lib/models';
import { IAzureQuickPickItem } from 'vscode-azureextensionui';
import { API, DBAccountKind, Experience } from './experience';

export function getExperienceFromApi_cosmosdb(api: API): Experience {
    let info = experiencesMap.get(api);
    if (!info) {
        info = { api: api, shortName: api, longName: api, kind: DBAccountKind.GlobalDocumentDB, tag: api };
    }
    return info;
}

export function getExperienceLabel_cosmosdb(account: DatabaseAccount): string {
    const experience: Experience | undefined = tryGetExperience_cosmosdb(account);
    if (experience) {
        return experience.shortName;
    }

    // Must be some new kind of account that we aren't aware of.  Try to get a decent label
    const defaultExperience: string = <API>(account && account.tags && account.tags.defaultExperience);
    const firstCapability = account.capabilities && account.capabilities[0];
    const firstCapabilityName = firstCapability && firstCapability.name.replace(/^Enable/, '');
    return defaultExperience || firstCapabilityName || account.kind;
}

export function tryGetExperience_cosmosdb(account: DatabaseAccount): Experience | undefined {
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

    return undefined;
}

export function getExperienceQuickPicks_cosmosdb(): IAzureQuickPickItem<Experience>[] {
    return experiencesArray.map(exp => getExperienceQuickPick_cosmosdb(exp.api));
}

export function getExperienceQuickPick_cosmosdb(api: API): IAzureQuickPickItem<Experience> {
    const exp = getExperienceFromApi_cosmosdb(api);
    return { label: exp.longName, description: exp.description, data: exp };
}

// Mongo is distinguished by having kind="MongoDB". All others have kind="GlobalDocumentDB"
// Table and Gremlin are distinguished from SQL by their capabilities
const CoreExperience: Experience = { api: API.Core, longName: "Core", description: "(SQL)", shortName: "SQL", kind: DBAccountKind.GlobalDocumentDB, tag: "Core (SQL)" };
const MongoExperience: Experience = { api: API.MongoDB, longName: "Azure Cosmos DB for MongoDB API", shortName: "MongoDB", kind: DBAccountKind.MongoDB, tag: "Azure Cosmos DB for MongoDB API" };
const TableExperience: Experience = { api: API.Table, longName: "Azure Table", shortName: "Table", kind: DBAccountKind.GlobalDocumentDB, capability: 'EnableTable', tag: "Azure Table" };
const GremlinExperience: Experience = { api: API.Graph, longName: "Gremlin", description: "(graph)", shortName: "Gremlin", kind: DBAccountKind.GlobalDocumentDB, capability: 'EnableGremlin', tag: "Gremlin (graph)" };

const experiencesArray: Experience[] = [CoreExperience, MongoExperience, TableExperience, GremlinExperience];
const experiencesMap = new Map<API, Experience>(experiencesArray.map((info: Experience): [API, Experience] => [info.api, info]));
