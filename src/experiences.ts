/* ------------------------------------------------------------------------------------------
 *   Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureQuickPickItem } from 'vscode-azureextensionui';

export enum API {
    MongoDB = 'MongoDB',
    Graph = 'Graph',
    Table = 'Table',
    DocumentDB = 'DocumentDB'
}

export enum DBAccountKind {
    MongoDB = 'MongoDB',
    GlobalDocumentDB = 'GlobalDocumentDB'
}

export function getExperience(api: API): Experience {
    let info = experiencesMap.get(api);
    if (!info) {
        info = { api: api, shortName: api, longName: api, kind: DBAccountKind.GlobalDocumentDB };
    }
    return info;
}

export interface Experience {
    /**
     * Programmatic name used by Azure
     */
    api: API;
    longName: string;
    shortName: string;
    description?: string;
    kind: DBAccountKind;
}

export function getExperienceQuickPicks(): IAzureQuickPickItem<Experience>[] {
    return experiencesArray.map(exp => getExperienceQuickPick(exp.api));
}

export function getExperienceQuickPick(api: API): IAzureQuickPickItem<Experience> {
    const exp = getExperience(api);
    return { label: exp.longName, description: exp.description, data: exp };
}

const experiencesArray: Experience[] = [
    { api: API.DocumentDB, longName: "SQL", description: "(DocumentDB)", shortName: "SQL", kind: DBAccountKind.GlobalDocumentDB },
    { api: API.MongoDB, longName: "MongoDB", shortName: "MongoDB", kind: DBAccountKind.MongoDB },
    { api: API.Table, longName: "Azure Table", shortName: "Table", kind: DBAccountKind.GlobalDocumentDB },
    { api: API.Graph, longName: "Gremlin", description: "(Graph)", shortName: "Gremlin", kind: DBAccountKind.GlobalDocumentDB }
];

const experiencesMap = new Map<API, Experience>(experiencesArray.map((info: Experience): [API, Experience] => [info.api, info]));
