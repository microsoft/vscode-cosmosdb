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
    databaseName?: string;
    /**
     * Account capacity mode decided during Phase 3 Step 8.
     * - `'serverless'` — uses the EnableServerless capability, no throughput config
     * - `'provisioned'` — uses autoscale throughput per container
     */
    capacityMode?: 'serverless' | 'provisioned';
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
    /**
     * Autoscale maximum RU/s for this container.
     * Only meaningful when the root model's `capacityMode` is `'provisioned'`.
     * Omitted for serverless accounts.
     */
    maxThroughput?: number;
    /**
     * Estimated total storage in GB at a 12-month projection (current data +
     * monthly growth rate compounded). Derived from volumetrics row counts,
     * average item size, a JSON inflation factor, indexing overhead, and TTL
     * caps when applicable. Treat as an estimate; production will differ.
     */
    estimatedStorageGB?: number;
    /**
     * Estimated current row count for this container (sum of contributing
     * entities, including embedded entities folded into the parent). Derived
     * from volumetrics.
     */
    estimatedRowCount?: number;
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
    /**
     * When `true`, this entity is fully embedded within another entity's document
     * and will not exist as a standalone document in the container. Embedded-only
     * entities are exempt from partition key alignment checks since they do not
     * produce their own top-level documents.
     */
    isEmbeddedOnly?: boolean;
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

/**
 * Response format for Step 8 (Final Cross-Domain Summary).
 * When the merged model is valid as-is, `updatedModel` is null and
 * `modelModified` is false — avoiding the cost of echoing the entire
 * model back through the LLM.
 */
export interface FinalSummaryResult {
    analysis: string;
    updatedModel: CosmosModel | null;
    modelModified: boolean;
}
