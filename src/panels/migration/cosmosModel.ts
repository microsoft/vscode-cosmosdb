/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TypeScript types for the cosmos-model.json file produced during Step 3 (Schema Conversion).
 *
 * The format is inspired by MongoDB's Relational Migrator .relmig schema mapping format
 * (https://www.mongodb.com/docs/relational-migrator/mapping-rules/schema-mapping/)
 * with additional Cosmos DB NoSQL-specific sections (partition keys, indexing, docType, etc.).
 *
 * The cosmos-model.json is progressively enriched through sub-steps 1–6:
 *   1. Container Design  → containers, entities, attributes (sourceType, docType, attribute mappings)
 *   2. Partition Key      → partitionKeys array per container (hierarchical PK support), isPartitionKey on attributes
 *   3. Embedding          → relationships with strategy (embed/reference) and scores
 *   4. Access Patterns    → accessPatterns array
 *   5. Cross-Partition    → crossPartitionQueries array
 *   6. Indexing           → indexingPolicy per container
 */

export interface CosmosModel {
    version: 1;
    domain: string;
    sourceType?: string;
    containers: CosmosContainer[];
    accessPatterns?: AccessPatternMapping[];
    crossPartitionQueries?: CrossPartitionQuery[];
}

export interface CosmosContainer {
    name: string;
    partitionKeys?: PartitionKeyConfig[];
    entities: CosmosEntity[];
    indexingPolicy?: IndexingPolicy;
}

export interface PartitionKeyConfig {
    path: string;
    candidates?: PartitionKeyCandidate[];
    analysis?: string;
}

export interface PartitionKeyCandidate {
    path: string;
    score: number;
    rationale: string;
}

export interface CosmosEntity {
    name: string;
    docType: string;
    sourceTable: string;
    attributes: CosmosAttribute[];
    relationships?: EntityRelationship[];
}

export interface CosmosAttribute {
    target: string;
    source: { table: string; column: string; type: string };
    type: string;
    isPartitionKey?: boolean;
    isId?: boolean;
}

export interface EntityRelationship {
    targetEntity: string;
    sourceFK: { table: string; column: string };
    type: 'one-to-one' | 'one-to-many' | 'many-to-many';
    strategy?: 'embed' | 'reference';
    score?: number;
    rationale?: string;
}

export interface IndexingPolicy {
    indexingMode?: string;
    automatic?: boolean;
    includedPaths: { path: string }[];
    excludedPaths: { path: string }[];
    compositeIndexes?: { path: string; order: 'ascending' | 'descending' }[][];
    fullTextPolicy?: { defaultLanguage: string; paths: string[] };
    fullTextIndexes?: { path: string }[];
}

export interface AccessPatternMapping {
    name: string;
    source: { type: string; query: string };
    target: {
        type: string;
        container: string;
        operation: string;
        query?: string;
        partitionKeyValue?: string;
        isCrossPartition: boolean;
        estimatedRU?: string;
    };
}

export interface CrossPartitionQuery {
    name: string;
    container: string;
    query: string;
    reason: string;
    estimatedRUCost: string;
    optimizations: string[];
}

/**
 * Wrapper response format for sub-steps 2–6 where the AI returns
 * both a markdown analysis and the updated cosmos-model.json.
 */
export interface SchemaConversionStepResult {
    analysis: string;
    updatedModel: CosmosModel;
}
