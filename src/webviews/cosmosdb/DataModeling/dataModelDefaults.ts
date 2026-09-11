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
 * Schemas, ordered partition keys, query predicates/QPS, and write distributions follow scenario
 * catalog 2.1. Enumerated fields supply cardinality defaults. Size, write-rate, and growth estimates
 * retain the prototype baselines where the catalog does not supply replacements.
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
    /** Known cardinality for catalog fields with enumerated possible values. */
    distinctValues?: number;
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
                    { name: 'model', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'tokens', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'createdAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                    { name: 'lastActivityAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 7, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get a session by sessionId'), filters: 'sessionId = @sessionId', qps: 200 },
                    { pattern: l10n.t("List a user's recent sessions"), filters: 'userId = @userId', qps: 60 },
                    { pattern: l10n.t('List sessions for a model'), filters: 'model = @model', qps: 10 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'even', growth: 'slow' },
            },
            {
                entity: 'Message',
                partitionKey: '/sessionId, /messageId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'messageId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'sessionId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'userId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'timestamp', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                    { name: 'role', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 4 },
                    { name: 'content', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'model', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'tokens', type: 'number', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 9, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    {
                        pattern: l10n.t('Get all messages for a sessionId'),
                        filters: 'sessionId = @sessionId',
                        qps: 200,
                    },
                    { pattern: l10n.t('Get all Messages by userId'), filters: 'userId = @userId', qps: 60 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'even', growth: 'slow' },
            },
            {
                entity: 'User',
                partitionKey: '/userId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'userId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'displayName', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'email', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'plan', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 4 },
                    { name: 'createdAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get all user records for a userId'), filters: 'userId = @userId', qps: 200 },
                    { pattern: l10n.t('Get a User by displayName'), filters: 'displayName = @displayName', qps: 60 },
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
                partitionKey: '/customerId, /orderId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'orderId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'customerId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'orderDate', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                    { name: 'status', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 5 },
                    { name: 'totalAmount', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'items', type: 'array', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 7, avgSizeKb: 3, maxSizeKb: 12 },
                arrays: { hasArrays: true, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get all orders for a customer'), filters: 'customerId = @customerId', qps: 200 },
                    { pattern: l10n.t('Get order by orderId'), filters: 'orderId = @orderId', qps: 60 },
                    { pattern: l10n.t('All pending orders (admin dashboard)'), filters: 'status = @status', qps: 10 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'even', growth: 'slow' },
            },
            {
                entity: 'Customer',
                partitionKey: '/customerId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'customerId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'email', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'name', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'tier', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 4 },
                    { name: 'createdAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    {
                        pattern: l10n.t('Get all customer records for a customerId'),
                        filters: 'customerId = @customerId',
                        qps: 200,
                    },
                    { pattern: l10n.t('Get customer by customerId'), filters: 'customerId = @customerId', qps: 60 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'even', growth: 'slow' },
            },
            {
                entity: 'LineItem',
                partitionKey: '/orderId, /lineItemId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'lineItemId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'orderId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'productId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'customerId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'quantity', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'unitPrice', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'subtotal', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'createdAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 9, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    {
                        pattern: l10n.t('Get all line item records for an orderId'),
                        filters: 'orderId = @orderId',
                        qps: 200,
                    },
                    { pattern: l10n.t('Get line item by lineItemId'), filters: 'lineItemId = @lineItemId', qps: 60 },
                    {
                        pattern: l10n.t('Get all line items for a createdAt timestamp'),
                        filters: 'createdAt = @createdAt',
                        qps: 10,
                    },
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
                partitionKey: '/deviceId, /id',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'deviceId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'timestamp', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                    { name: 'location', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'deviceType', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'metricName', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 4 },
                    { name: 'reading', type: 'number', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 7, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'append' },
                reads: [
                    {
                        pattern: l10n.t('Get telemetry for a device (optionally in a time range)'),
                        filters: 'deviceId = @deviceId AND timestamp >= @startTime AND timestamp <= @endTime',
                        qps: 80,
                    },
                    { pattern: l10n.t('Latest reading per device'), filters: 'deviceId = @deviceId', qps: 20 },
                    {
                        pattern: l10n.t('Aggregate readings across a site for one metric'),
                        filters: 'location = @location AND metricName = @metricName',
                        qps: 5,
                    },
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
                    { name: 'entityType', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 4 },
                    { name: 'createdAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                    { name: 'plan', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 4 },
                    { name: 'payload', type: 'object', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 2, maxSizeKb: 8 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get all records for a tenant'), filters: 'tenantId = @tenantId', qps: 200 },
                    {
                        pattern: l10n.t('Get a record by ID within a tenant'),
                        filters: 'id = @id AND tenantId = @tenantId',
                        qps: 60,
                    },
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
                    { name: 'embedding', type: 'array', role: 'payload', pkCandidate: false },
                    { name: 'category', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 5 },
                ],
                document: { attributeCount: 6, avgSizeKb: 7, maxSizeKb: 28 },
                arrays: { hasArrays: true, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    {
                        pattern: l10n.t('Get all chunks for a source document'),
                        filters: 'sourceId = @sourceId',
                        qps: 800,
                    },
                    {
                        pattern: l10n.t('Vector search within a source or category'),
                        filters: 'category = @category',
                        qps: 150,
                    },
                    { pattern: l10n.t('Get a chunk by ID'), filters: 'id = @id AND sourceId = @sourceId', qps: 20 },
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
                partitionKey: '/conversationId, /messageId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'messageId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'conversationId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'userId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'createdAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                    { name: 'body', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'reactions', type: 'array', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 7, avgSizeKb: 3, maxSizeKb: 12 },
                arrays: { hasArrays: true, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    {
                        pattern: l10n.t('Get messages in a conversation'),
                        filters: 'conversationId = @conversationId',
                        qps: 200,
                    },
                    {
                        pattern: l10n.t('Get a message within a conversation'),
                        filters: 'conversationId = @conversationId AND messageId = @messageId',
                        qps: 20,
                    },
                    { pattern: l10n.t("Get a user's message"), filters: 'userId = @userId', qps: 60 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
            },
            {
                entity: 'User',
                partitionKey: '/userId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'userId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'handle', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'displayName', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'followerCount', type: 'number', role: 'filter', pkCandidate: false },
                    { name: 'createdAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get a record for a userId'), filters: 'userId = @userId', qps: 200 },
                    {
                        pattern: l10n.t('Get all users with followerCount greater than a specified value'),
                        filters: 'followerCount >= @followerCount',
                        qps: 60,
                    },
                    { pattern: l10n.t('Get a userId by handle'), filters: 'handle = @handle', qps: 60 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
            },
            {
                entity: 'Conversation',
                partitionKey: '/conversationId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'conversationId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'participantIds', type: 'array', role: 'payload', pkCandidate: false },
                    { name: 'lastMessageId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'type', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 4 },
                ],
                document: { attributeCount: 5, avgSizeKb: 3, maxSizeKb: 12 },
                arrays: { hasArrays: true, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    {
                        pattern: l10n.t('Get all Conversation records for a conversationId'),
                        filters: 'conversationId = @conversationId',
                        qps: 200,
                    },
                    { pattern: l10n.t('Get the last message'), filters: 'conversationId = @conversationId', qps: 50 },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
            },
        ],
    },
    catalog: {
        containers: [
            {
                entity: 'Product',
                partitionKey: '/categoryId, /productId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'productId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'categoryId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'sellerId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'name', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'price', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'inStock', type: 'boolean', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 7, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('List products in a category'), filters: 'categoryId = @categoryId', qps: 800 },
                    { pattern: l10n.t('Get product by productId'), filters: 'productId = @productId', qps: 150 },
                    { pattern: l10n.t('List all products'), filters: '', qps: 10 },
                ],
                writes: { insertsPerSec: 5, updatesPerSec: 3, deletesPerSec: 1 },
                scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
            },
            {
                entity: 'Category',
                partitionKey: '/categoryId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'categoryId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'categoryName', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'parentCategoryId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'displayOrder', type: 'number', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 5, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    {
                        pattern: l10n.t('Get all Category records for a categoryId'),
                        filters: 'categoryId = @categoryId',
                        qps: 800,
                    },
                    {
                        pattern: l10n.t('Get the cateogry parent for a categoryId'),
                        filters: 'categoryId = @categoryId',
                        qps: 150,
                    },
                ],
                writes: { insertsPerSec: 5, updatesPerSec: 3, deletesPerSec: 1 },
                scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
            },
            {
                entity: 'Inventory',
                partitionKey: '/warehouseId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'sku', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'warehouseId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'quantity', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'updatedAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 5, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    {
                        pattern: l10n.t('Get all Inventory records for a warehouseId and sku'),
                        filters: 'warehouseId = @warehouseId AND sku = @sku',
                        qps: 800,
                    },
                    {
                        pattern: l10n.t('Get a Inventory by warehouseId'),
                        filters: 'warehouseId = @warehouseId',
                        qps: 150,
                    },
                ],
                writes: { insertsPerSec: 5, updatesPerSec: 3, deletesPerSec: 1 },
                scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
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
                    { name: 'season', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 5 },
                    { name: 'score', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'matchId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'updatedAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    {
                        pattern: l10n.t("Get a player's state and current match score"),
                        filters: 'playerId = @playerId',
                        qps: 200,
                    },
                    {
                        pattern: l10n.t('Get player by ID (point read)'),
                        filters: 'id = @id and playerId = @playerId',
                        qps: 60,
                    },
                    { pattern: l10n.t('Top-N global leaderboard (precomputed)'), filters: 'season = @season', qps: 10 },
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
                partitionKey: '/userId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'userId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'email', type: 'string', role: 'filter', pkCandidate: false },
                    { name: 'displayName', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'preferences', type: 'object', role: 'payload', pkCandidate: false },
                    { name: 'segment', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 5 },
                    { name: 'createdAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 7, avgSizeKb: 2, maxSizeKb: 8 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get a profile by userId (point read)'), filters: 'userId = @userId', qps: 800 },
                    { pattern: l10n.t('Look up profile by email'), filters: 'email = @email', qps: 150 },
                    { pattern: l10n.t('List users in a segment (admin)'), filters: 'segment = @segment', qps: 20 },
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
                    { name: 'eventType', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 7 },
                    { name: 'occurredAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                    { name: 'data', type: 'object', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 2, maxSizeKb: 8 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'append' },
                reads: [
                    {
                        pattern: l10n.t('Replay all events for an aggregate/stream'),
                        filters: 'streamId = @streamId',
                        qps: 80,
                    },
                    { pattern: l10n.t('Get an event by ID'), filters: 'id = @id AND streamId = @streamId', qps: 20 },
                    {
                        pattern: l10n.t('Audit query over a time range (compliance)'),
                        filters: 'occurredAt >= @startDate AND occurredAt <= @endDate',
                        qps: 5,
                    },
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
                    { name: 'eventName', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 10 },
                    { name: 'url', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'ts', type: 'string (ISO)', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 6, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'append' },
                reads: [
                    { pattern: l10n.t('Get all events in a session'), filters: 'sessionId = @sessionId', qps: 80 },
                    { pattern: l10n.t("Reconstruct a user's funnel"), filters: 'userId = @userId', qps: 20 },
                    {
                        pattern: l10n.t('Global aggregates / rollups (batch)'),
                        filters: 'eventName = @eventName',
                        qps: 5,
                    },
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
                partitionKey: '/siteId, /contentId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'contentId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'siteId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'contentType', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 6 },
                    { name: 'status', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 4 },
                    { name: 'author', type: 'string', role: 'payload', pkCandidate: false },
                    { name: 'updatedAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 7, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('List content for a site/space'), filters: 'siteId = @siteId', qps: 800 },
                    { pattern: l10n.t('Get a content item by contentId'), filters: 'contentId = @contentId', qps: 150 },
                    {
                        pattern: l10n.t('Search published content across sites'),
                        filters: 'status = @status AND contentType = @contentType',
                        qps: 20,
                    },
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
                partitionKey: '/accountId, /ledgerId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'ledgerId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'accountId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'amount', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'currency', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 6 },
                    { name: 'type', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 6 },
                    { name: 'postedAt', type: 'string (ISO)', role: 'payload', pkCandidate: false },
                ],
                document: { attributeCount: 7, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    {
                        pattern: l10n.t('Get all transactions for an account'),
                        filters: 'accountId = @accountId',
                        qps: 200,
                    },
                    { pattern: l10n.t('Get a transaction by ledgerId'), filters: 'ledgerId = @ledgerId', qps: 60 },
                    { pattern: l10n.t('Daily reconciliation report (batch)'), filters: 'type = @type', qps: 10 },
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
                    { name: 'quantity', type: 'number', role: 'filter', pkCandidate: false },
                    { name: 'unitOfMeasure', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 5 },
                    { name: 'category', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 6 },
                    { name: 'updatedAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { attributeCount: 7, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    { pattern: l10n.t('Get stock for a SKU across warehouses'), filters: 'skuId = @skuId', qps: 200 },
                    {
                        pattern: l10n.t('Get stock for a SKU in one warehouse'),
                        filters: 'skuId = @skuId AND warehouseId = @warehouseId',
                        qps: 60,
                    },
                    {
                        pattern: l10n.t('Low-stock report per warehouse (batch)'),
                        filters: 'quantity <= @threshold AND warehouseId = @warehouseId',
                        qps: 10,
                    },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'low', writes: 'even', growth: 'bounded' },
            },
            {
                entity: 'InventoryMovement',
                partitionKey: '/skuId, /movementId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'movementId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'skuId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'warehouseId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'movementType', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 8 },
                    { name: 'quantityDelta', type: 'number', role: 'payload', pkCandidate: false },
                    { name: 'unitOfMeasure', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 5 },
                    { name: 'occurredAt', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                ],
                document: { avgSizeKb: 1, maxSizeKb: 4, attributeCount: 8 },
                arrays: { avgItems: 10, maxItems: 100, updatePattern: 'none', hasArrays: false },
                reads: [
                    {
                        pattern: l10n.t('Get movement history for a SKU in a bounded time range'),
                        filters: 'skuId = @skuId AND occurredAt >= @startDate AND occurredAt < @endDate',
                        qps: 80,
                    },
                    {
                        pattern: l10n.t('Get movement history for a SKU in one warehouse'),
                        filters:
                            'skuId = @skuId AND warehouseId = @warehouseId AND occurredAt >= @startDate AND occurredAt < @endDate',
                        qps: 30,
                    },
                    {
                        pattern: l10n.t('Get an inventory movement by ID within its SKU'),
                        filters: 'id = @id AND skuId = @skuId',
                        qps: 20,
                    },
                ],
                writes: { insertsPerSec: 40, updatesPerSec: 25, deletesPerSec: 5 },
                scale: { items: 'medium', growth: 'slow', writes: 'even' },
            },
        ],
    },
    booking: {
        containers: [
            {
                entity: 'Reservation',
                partitionKey: '/propertyId, /reservationId',
                properties: [
                    { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'reservationId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'propertyId', type: 'string', role: 'key', pkCandidate: true },
                    { name: 'guestId', type: 'string', role: 'key', pkCandidate: false },
                    { name: 'checkIn', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                    { name: 'checkOut', type: 'string (ISO)', role: 'filter', pkCandidate: false },
                    { name: 'status', type: 'string', role: 'filter', pkCandidate: false, distinctValues: 5 },
                ],
                document: { attributeCount: 7, avgSizeKb: 1, maxSizeKb: 4 },
                arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
                reads: [
                    {
                        pattern: l10n.t('Get reservations for a property/resource'),
                        filters: 'propertyId = @propertyId',
                        qps: 200,
                    },
                    {
                        pattern: l10n.t('Get a reservation by reservationId'),
                        filters: 'reservationId = @reservationId',
                        qps: 60,
                    },
                    {
                        pattern: l10n.t('Availability across a date range'),
                        filters: 'propertyId = @propertyId AND checkOut > @startDate AND checkIn < @endDate',
                        qps: 10,
                    },
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
