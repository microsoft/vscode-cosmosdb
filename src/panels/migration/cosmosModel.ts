/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TypeScript types for the cosmos-model.json file produced during Step 3 (Schema Conversion).
 *
 * Source-neutral lineage refers to the preflight inventory. Legacy relational lineage remains
 * readable through the skill's validated compatibility boundary.
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
     * - `'provisioned'` — uses dedicated container autoscale or shared database autoscale
     */
    capacityMode?: 'serverless' | 'provisioned';
    databaseMaxThroughput?: number;
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
     * Only meaningful for dedicated throughput with `'provisioned'` account capacity.
     * Omitted for serverless accounts and shared-throughput containers.
     */
    maxThroughput?: number;
    throughputMode?: 'shared' | 'dedicated';
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

export interface SourceFieldReference {
    dataset: string;
    field: string;
}

export type CosmosIdentity =
    | {
          kind: 'fields';
          fields: SourceFieldReference[];
          encoding: 'typed-hex-v1' | 'native-uuid';
      }
    | { kind: 'generated-uuid' };

export type CosmosEntity = {
    name: string;
    docType: string;
    attributes: CosmosAttribute[];
    relationships?: EntityRelationship[];
    /**
     * When `true`, this entity is fully embedded within another entity's document
     * and will not exist as a standalone document in the container. Embedded-only
     * entities are exempt from partition key alignment checks since they do not
     * produce their own top-level documents.
     */
    isEmbeddedOnly?: boolean;
} & ({ sourceDataset: string; sourceTable?: never } | { sourceTable: string; sourceDataset?: never }) &
    (
        | { identity: CosmosIdentity; idTemplate?: never }
        | {
              identity?: never;
              /** Legacy templates are validated against the original relational primary-key columns. */
              idTemplate?: string;
          }
    );

export interface CosmosAttribute {
    target: string;
    source:
        | { table: string; column: string; type: string }
        | (SourceFieldReference & { type: string })
        | { inputs: SourceFieldReference[]; type: string }
        | { generated: 'uuid' | 'constant'; type: string };
    type: string;
    isPartitionKey?: boolean;
    isId?: boolean;
    optional?: boolean;
    nullable?: boolean;
}

export type EntityRelationship = {
    targetEntity: string;
    type: 'one-to-one' | 'one-to-many' | 'many-to-many';
    strategy?: 'embed' | 'reference';
    targetProperty?: string;
    score?: number;
    rationale?: string;
} & (
    | { sourceRelationship: string; sourceFK?: never }
    | {
          sourceFK: { table: string; column: string; type?: string; constraintName?: string };
          sourceRelationship?: never;
      }
);

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
