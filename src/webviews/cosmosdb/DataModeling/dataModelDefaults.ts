/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Hardcoded per-workload default values for the {@link DataModel}.
 *
 * Selecting a workload on the Workload page seeds the whole data model from the matching
 * entry here (see `buildDataModel` in {@link ./dataModel}). Everything a fresh model needs
 * lives in this single object. Because the Data, Queries and Scale pages are all
 * **per-container**, every container carries its own schema, document shape, array profile,
 * read patterns, write rates, and scale characteristics. Entries are id-less; runtime ids are
 * assigned when the model is instantiated.
 *
 * The values are captured from the Partition Key Advisor prototype's per-container derivation:
 * name-based property roles, a size estimate from the schema, read QPS and write TPS weighted by
 * each workload's read/write profile, and the workload's scale defaults (sibling containers use
 * the prototype's neutral `medium / even / slow` defaults).
 */

import * as l10n from '@vscode/l10n';
import {
    type ArrayProfile,
    type DataGrowth,
    type DocumentShape,
    type ItemsPerPartition,
    type PropertyRole,
    type PropertyType,
    type ScenarioId,
    type WriteDistribution,
    type WriteOps,
} from './models';

/** A schema property default (no runtime id). */
export interface PropertyDefault {
    name: string;
    type: PropertyType;
    role: PropertyRole;
    pkCandidate: boolean;
}

/** A read-query default (no runtime id). */
export interface ReadDefault {
    pattern: string;
    filters: string;
    qps: number;
}

/** Per-container scale characteristics. */
export interface ScaleDefault {
    items: ItemsPerPartition;
    writes: WriteDistribution;
    growth: DataGrowth;
}

/**
 * A container default (no runtime id). Carries everything the Data, Queries and Scale pages edit
 * for a single container: schema, document shape, array profile, read patterns, write rates, and
 * scale characteristics.
 */
export interface ContainerDefault {
    entity: string;
    partitionKey: string;
    properties: PropertyDefault[];
    document: DocumentShape;
    arrays: ArrayProfile;
    reads: ReadDefault[];
    writes: WriteOps;
    scale: ScaleDefault;
}

/** All default values for one workload's data model: a list of fully-specified containers. */
export interface DataModelDefaults {
    containers: ContainerDefault[];
}

/** The single hardcoded object mapping every workload to its default data-model values. */
export const DATA_MODEL_DEFAULTS: Record<ScenarioId, DataModelDefaults> = {
    chat: {
        containers: [
            {
                entity: 'ChatSession',
                partitionKey: '/sessionId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'sessionId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'userId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'timestamp', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                    { name: 'role', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'content', type: 'string', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get all messages in a session'), filters: 'sessionId', qps: 200 },
                    { pattern: l10n.t("List a user's recent sessions"), filters: 'sessionId, userId', qps: 60 },
                    { pattern: l10n.t('Full-text search across messages (admin)'), filters: 'timestamp', qps: 10 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'even', growth: 'slow' },
            },
            {
                entity: 'Message',
                partitionKey: '/sessionId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'sessionId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'role', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'content', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'tokens', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'timestamp', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get all Message records for a sessionId'), filters: 'sessionId', qps: 200 },
                    { pattern: l10n.t('Get a Message by id'), filters: 'id', qps: 60 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'even', growth: 'slow' },
            },
            {
                entity: 'User',
                partitionKey: '/id',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'displayName', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'email', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'plan', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'createdAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get all User records for a id'), filters: 'id', qps: 200 },
                    { pattern: l10n.t('Get a User by id'), filters: 'id', qps: 60 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'even', growth: 'slow' },
            },
        ],
    },
    ecommerce: {
        containers: [
            {
                entity: 'Orders',
                partitionKey: '/customerId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'customerId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'orderDate', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                    { name: 'status', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'totalAmount', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'items', type: 'array', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 3, maxSizeKb: 12 },
                arrays: { hasArrays: true, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get all orders for a customer'), filters: 'customerId', qps: 200 },
                    { pattern: l10n.t('Get order by ID'), filters: 'id', qps: 60 },
                    { pattern: l10n.t('All pending orders (admin dashboard)'), filters: 'status', qps: 10 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'even', growth: 'slow' },
            },
            {
                entity: 'Customer',
                partitionKey: '/id',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'email', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'name', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'tier', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'createdAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get all Customer records for a id'), filters: 'id', qps: 200 },
                    { pattern: l10n.t('Get a Customer by id'), filters: 'id', qps: 60 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'even', growth: 'slow' },
            },
            {
                entity: 'LineItem',
                partitionKey: '/orderId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'orderId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'sku', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'quantity', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'unitPrice', type: 'number', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get all LineItem records for a orderId'), filters: 'orderId', qps: 200 },
                    { pattern: l10n.t('Get a LineItem by id'), filters: 'id', qps: 60 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'even', growth: 'slow' },
            },
        ],
    },
    iot: {
        containers: [
            {
                entity: 'DeviceTelemetry',
                partitionKey: '/deviceId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'deviceId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'timestamp', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                    { name: 'location', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'deviceType', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'temperature', type: 'number', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'append' },
                reads: [
                    {
                        pattern: l10n.t('Get telemetry for a device (optionally in a time range)'),
                        filters: 'deviceId',
                        qps: 80,
                    },
                    { pattern: l10n.t('Latest reading per device'), filters: 'deviceId', qps: 20 },
                    { pattern: l10n.t('Aggregate readings across a site (batch)'), filters: 'timestamp', qps: 5 },
                ],
                writes: { insertsPerSec: 500, updatesPerSec: 60, deletesPerSec: 10 },
                scale: { items: 'high', writes: 'time', growth: 'rapid' },
            },
        ],
    },
    multitenant: {
        containers: [
            {
                entity: 'TenantRecord',
                partitionKey: '/tenantId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'tenantId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'entityType', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'createdAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                    { name: 'plan', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'payload', type: 'object', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 2, maxSizeKb: 8 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get all records for a tenant'), filters: 'tenantId', qps: 200 },
                    { pattern: l10n.t('Get a record by ID within a tenant'), filters: 'id, tenantId', qps: 60 },
                    { pattern: l10n.t('Cross-tenant usage report (admin)'), filters: 'tenantId', qps: 10 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'high', writes: 'skewed', growth: 'slow' },
            },
        ],
    },
    rag: {
        containers: [
            {
                entity: 'DocumentChunk',
                partitionKey: '/sourceId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'sourceId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'chunkIndex', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'content', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'embedding', type: 'number[]', role: 'payload', pkCandidate: false },
                    { name: 'category', type: 'string', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 7, maxSizeKb: 28 },
                arrays: { hasArrays: true, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get all chunks for a source document'), filters: 'sourceId', qps: 800 },
                    {
                        pattern: l10n.t('Vector search within a source or category'),
                        filters: 'sourceId, category',
                        qps: 150,
                    },
                    { pattern: l10n.t('Get a chunk by ID'), filters: 'id', qps: 20 },
                ],
                writes: { insertsPerSec: 5, updatesPerSec: 3, deletesPerSec: 1 },
                scale: { items: 'medium', writes: 'even', growth: 'bounded' },
            },
        ],
    },
    social: {
        containers: [
            {
                entity: 'Message',
                partitionKey: '/conversationId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'conversationId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'userId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'createdAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                    { name: 'body', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'reactions', type: 'array', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 3, maxSizeKb: 12 },
                arrays: { hasArrays: true, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get messages in a conversation'), filters: 'conversationId', qps: 200 },
                    { pattern: l10n.t("Get a user's posts / feed"), filters: 'userId', qps: 60 },
                    { pattern: l10n.t('Trending / global timeline (batch)'), filters: 'createdAt', qps: 10 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
            },
            {
                entity: 'User',
                partitionKey: '/id',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'handle', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'displayName', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'followerCount', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'createdAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get all User records for a id'), filters: 'id', qps: 200 },
                    { pattern: l10n.t('Get a User by id'), filters: 'id', qps: 60 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'even', growth: 'slow' },
            },
            {
                entity: 'Conversation',
                partitionKey: '/id',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'participantIds', type: 'array', role: 'payload', pkCandidate: false },
                    { name: 'lastMessageAt', type: 'string (ISO)', role: 'payload', pkCandidate: false },
                    { name: 'type', type: 'string', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 3, maxSizeKb: 12 },
                arrays: { hasArrays: true, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get all Conversation records for a id'), filters: 'id', qps: 200 },
                    { pattern: l10n.t('Get a Conversation by id'), filters: 'id', qps: 60 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'even', growth: 'slow' },
            },
        ],
    },
    catalog: {
        containers: [
            {
                entity: 'Product',
                partitionKey: '/categoryId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'categoryId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'sellerId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'name', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'price', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'inStock', type: 'boolean', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('List products in a category'), filters: 'categoryId', qps: 800 },
                    { pattern: l10n.t('Get product by ID'), filters: 'id', qps: 150 },
                    { pattern: l10n.t('Search across the whole catalog'), filters: 'id', qps: 20 },
                ],
                writes: { insertsPerSec: 5, updatesPerSec: 3, deletesPerSec: 1 },
                scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
            },
            {
                entity: 'Category',
                partitionKey: '/id',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'name', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'parentId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'displayOrder', type: 'number', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get all Category records for a id'), filters: 'id', qps: 800 },
                    { pattern: l10n.t('Get a Category by id'), filters: 'id', qps: 150 },
                ],
                writes: { insertsPerSec: 5, updatesPerSec: 3, deletesPerSec: 1 },
                scale: { items: 'medium', writes: 'even', growth: 'slow' },
            },
            {
                entity: 'Inventory',
                partitionKey: '/sku',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'sku', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'warehouseId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'quantity', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'updatedAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get all Inventory records for a sku'), filters: 'sku', qps: 800 },
                    { pattern: l10n.t('Get a Inventory by id'), filters: 'id', qps: 150 },
                ],
                writes: { insertsPerSec: 5, updatesPerSec: 3, deletesPerSec: 1 },
                scale: { items: 'medium', writes: 'even', growth: 'slow' },
            },
        ],
    },
    gaming: {
        containers: [
            {
                entity: 'PlayerState',
                partitionKey: '/playerId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'playerId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'season', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'score', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'matchId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'updatedAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t("Get a player's state and match history"), filters: 'playerId', qps: 200 },
                    { pattern: l10n.t('Get player by ID (point read)'), filters: 'id, playerId', qps: 60 },
                    { pattern: l10n.t('Top-N global leaderboard (precomputed)'), filters: 'updatedAt', qps: 10 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'even', growth: 'slow' },
            },
        ],
    },
    profiles: {
        containers: [
            {
                entity: 'UserProfile',
                partitionKey: '/id',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'email', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'displayName', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'preferences', type: 'object', role: 'payload', pkCandidate: false },
                    { name: 'segment', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'createdAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 2, maxSizeKb: 8 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get a profile by user ID (point read)'), filters: 'id', qps: 800 },
                    { pattern: l10n.t('Look up profile by email'), filters: 'email', qps: 150 },
                    { pattern: l10n.t('List users in a segment (admin)'), filters: 'segment', qps: 20 },
                ],
                writes: { insertsPerSec: 5, updatesPerSec: 3, deletesPerSec: 1 },
                scale: { items: 'low', writes: 'even', growth: 'bounded' },
            },
        ],
    },
    eventsourcing: {
        containers: [
            {
                entity: 'DomainEvent',
                partitionKey: '/streamId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'streamId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'sequence', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'eventType', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'occurredAt', type: 'string (ISO)', role: 'payload', pkCandidate: false },
                    { name: 'data', type: 'object', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 2, maxSizeKb: 8 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'append' },
                reads: [
                    { pattern: l10n.t('Replay all events for an aggregate/stream'), filters: 'streamId', qps: 80 },
                    { pattern: l10n.t('Get an event by ID'), filters: 'id', qps: 20 },
                    { pattern: l10n.t('Audit query over a time range (compliance)'), filters: 'eventType', qps: 5 },
                ],
                writes: { insertsPerSec: 500, updatesPerSec: 60, deletesPerSec: 10 },
                scale: { items: 'medium', writes: 'even', growth: 'slow' },
            },
        ],
    },
    analytics: {
        containers: [
            {
                entity: 'ClickEvent',
                partitionKey: '/sessionId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'sessionId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'userId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'eventName', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'url', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'ts', type: 'string (ISO)', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'append' },
                reads: [
                    { pattern: l10n.t('Get all events in a session'), filters: 'sessionId', qps: 80 },
                    { pattern: l10n.t("Reconstruct a user's funnel"), filters: 'userId', qps: 20 },
                    { pattern: l10n.t('Global aggregates / rollups (batch)'), filters: 'id', qps: 5 },
                ],
                writes: { insertsPerSec: 500, updatesPerSec: 60, deletesPerSec: 10 },
                scale: { items: 'medium', writes: 'time', growth: 'slow' },
            },
        ],
    },
    cms: {
        containers: [
            {
                entity: 'ContentItem',
                partitionKey: '/siteId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'siteId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'contentType', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'status', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'author', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'updatedAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('List content for a site/space'), filters: 'siteId', qps: 800 },
                    { pattern: l10n.t('Get a content item by ID'), filters: 'id', qps: 150 },
                    { pattern: l10n.t('Search published content across sites'), filters: 'siteId, status', qps: 20 },
                ],
                writes: { insertsPerSec: 5, updatesPerSec: 3, deletesPerSec: 1 },
                scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
            },
        ],
    },
    ledger: {
        containers: [
            {
                entity: 'LedgerEntry',
                partitionKey: '/accountId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'accountId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'amount', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'currency', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'type', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'postedAt', type: 'string (ISO)', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get all transactions for an account'), filters: 'accountId', qps: 200 },
                    { pattern: l10n.t('Get a transaction by ID'), filters: 'id', qps: 60 },
                    { pattern: l10n.t('Daily reconciliation report (batch)'), filters: 'type', qps: 10 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'high', writes: 'skewed', growth: 'slow' },
            },
        ],
    },
    inventory: {
        containers: [
            {
                entity: 'StockLevel',
                partitionKey: '/skuId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'skuId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'warehouseId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'quantity', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'category', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'updatedAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get stock for a SKU across warehouses'), filters: 'skuId', qps: 200 },
                    { pattern: l10n.t('Get stock for a SKU in one warehouse'), filters: 'skuId, warehouseId', qps: 60 },
                    { pattern: l10n.t('Low-stock report per warehouse (batch)'), filters: 'warehouseId', qps: 10 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'low', writes: 'even', growth: 'bounded' },
            },
        ],
    },
    booking: {
        containers: [
            {
                entity: 'Reservation',
                partitionKey: '/propertyId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'propertyId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'guestId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'checkIn', type: 'string (ISO)', role: 'payload', pkCandidate: false },
                    { name: 'checkOut', type: 'string (ISO)', role: 'payload', pkCandidate: false },
                    { name: 'status', type: 'string', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get reservations for a property/resource'), filters: 'propertyId', qps: 200 },
                    { pattern: l10n.t('Get a reservation by ID'), filters: 'id', qps: 60 },
                    { pattern: l10n.t('Availability across a date range'), filters: 'status', qps: 10 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
            },
        ],
    },
    other: {
        containers: [
            {
                entity: 'Entity',
                partitionKey: '/id',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'type', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'createdAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                    { name: 'data', type: 'object', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 2, maxSizeKb: 8 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [{ pattern: l10n.t('Describe your dominant query'), filters: 'id', qps: 200 }],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'even', growth: 'slow' },
            },
        ],
    },
};
