/* ------------------------------------------------------------------------------------------
 *   Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
