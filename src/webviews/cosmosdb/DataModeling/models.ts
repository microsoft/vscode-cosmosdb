/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Domain models for the Data-Modeling (Partition Key Advisor) wizard.
 *
 * The wizard is a UI prototype: these types describe just enough shape to drive
 * the six pages and to be handed, unchanged, to a future generic wizard package.
 * Each page component receives a slice of {@link WizardState} plus an update
 * callback, so no page reaches into global state directly.
 */

export type ScenarioId =
    | 'chat'
    | 'ecommerce'
    | 'iot'
    | 'multitenant'
    | 'rag'
    | 'social'
    | 'catalog'
    | 'gaming'
    | 'profiles'
    | 'eventsourcing'
    | 'analytics'
    | 'cms'
    | 'ledger'
    | 'inventory'
    | 'booking'
    | 'other';

export type PropertyType = 'string' | 'string (ISO)' | 'number' | 'boolean' | 'array' | 'object' | 'number[]' | 'guid';

export const PROPERTY_TYPES: PropertyType[] = [
    'string',
    'string (ISO)',
    'number',
    'boolean',
    'array',
    'object',
    'number[]',
    'guid',
];

/** How a property participates in partition-key selection and query filtering. */
export type PropertyRole = 'key' | 'filter' | 'payload';

export interface SchemaProperty {
    id: string;
    name: string;
    type: PropertyType;
    role: PropertyRole;
    /** Marked by the user as a partition-key candidate. */
    pkCandidate: boolean;
}

export interface DocumentShape {
    attributeCount: number;
    avgSizeKb: number;
    maxSizeKb: number;
}

export type ArrayUpdatePattern = 'none' | 'append' | 'patch' | 'replace';

export interface ArrayProfile {
    hasArrays: boolean;
    avgItems: number;
    maxItems: number;
    updatePattern: ArrayUpdatePattern;
}

/** One container being modeled. A workload can span several containers. */
export interface ContainerModel {
    id: string;
    entity: string;
    partitionKey: string;
    properties: SchemaProperty[];
    document: DocumentShape;
    arrays: ArrayProfile;
}

export interface ReadQuery {
    id: string;
    pattern: string;
    filters: string;
    /** Peak queries per second. */
    qps: number;
}

export interface WriteOps {
    insertsPerSec: number;
    updatesPerSec: number;
    deletesPerSec: number;
}

export type ItemsPerPartition = 'low' | 'medium' | 'high' | 'very-high';
export type WriteDistribution = 'even' | 'skewed' | 'time';
export type DataGrowth = 'bounded' | 'slow' | 'rapid';

export interface PartitionCandidate {
    id: string;
    attribute: string;
    role: PropertyRole;
    distinctValues: number;
}

export interface ScaleProfile {
    candidates: PartitionCandidate[];
    items: ItemsPerPartition;
    writes: WriteDistribution;
    growth: DataGrowth;
}

export interface ScoringWeights {
    read: number;
    write: number;
    storage: number;
}

export const TOTAL_STEPS = 6;
