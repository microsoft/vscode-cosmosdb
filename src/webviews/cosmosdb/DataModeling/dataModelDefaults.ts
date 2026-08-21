/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Hardcoded per-workload default values for the {@link DataModel}.
 *
 * Selecting a workload on the Workload page seeds the whole data model from the matching
 * entry here (see `buildDataModel` in {@link ./dataModel}). Everything a fresh model needs
 * — container schemas, document shape, arrays, read patterns, write rates, and scale
 * characteristics — lives in this single object. Entries are id-less; runtime ids are
 * assigned when the model is instantiated.
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

/** A container default (no runtime id): schema plus document shape and array profile. */
export interface ContainerDefault {
    entity: string;
    partitionKey: string;
    properties: PropertyDefault[];
    document: DocumentShape;
    arrays: ArrayProfile;
}

/** A read-query default (no runtime id). */
export interface ReadDefault {
    pattern: string;
    filters: string;
    qps: number;
}

/** All default values for one workload's data model. */
export interface DataModelDefaults {
    containers: ContainerDefault[];
    reads: ReadDefault[];
    writes: WriteOps;
    scale: { items: ItemsPerPartition; writes: WriteDistribution; growth: DataGrowth };
}

// Shared document/array defaults applied to every seeded container.
const DEFAULT_DOCUMENT: DocumentShape = { attributeCount: 12, avgSizeKb: 2, maxSizeKb: 8 };
const DEFAULT_ARRAYS: ArrayProfile = { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' };

// Concise property-default builders, one per role.
const key = (name: string, type: PropertyType = 'string'): PropertyDefault => ({
    name,
    type,
    role: 'key',
    pkCandidate: false,
});
const filter = (name: string, type: PropertyType = 'string'): PropertyDefault => ({
    name,
    type,
    role: 'filter',
    pkCandidate: false,
});
const payload = (name: string, type: PropertyType = 'string'): PropertyDefault => ({
    name,
    type,
    role: 'payload',
    pkCandidate: false,
});
const pk = (name: string, type: PropertyType = 'string'): PropertyDefault => ({
    name,
    type,
    role: 'key',
    pkCandidate: true,
});

const container = (entity: string, partitionKey: string, properties: PropertyDefault[]): ContainerDefault => ({
    entity,
    partitionKey,
    properties,
    document: DEFAULT_DOCUMENT,
    arrays: DEFAULT_ARRAYS,
});

/** The single hardcoded object mapping every workload to its default data-model values. */
export const DATA_MODEL_DEFAULTS: Record<ScenarioId, DataModelDefaults> = {
    chat: {
        containers: [
            container('ChatSession', '/sessionId', [
                key('id'),
                pk('sessionId'),
                filter('userId'),
                filter('timestamp', 'string (ISO)'),
                filter('role'),
                payload('content'),
            ]),
            container('Message', '/sessionId', [
                key('id'),
                pk('sessionId'),
                filter('role'),
                payload('content'),
                payload('tokens', 'number'),
                filter('timestamp', 'string (ISO)'),
            ]),
            container('User', '/id', [pk('id'), filter('email'), payload('displayName'), filter('plan')]),
        ],
        reads: [
            { pattern: l10n.t('Get all messages in a session'), filters: 'sessionId', qps: 120 },
            { pattern: l10n.t("List a user's recent sessions"), filters: 'userId', qps: 40 },
        ],
        writes: { insertsPerSec: 30, updatesPerSec: 5, deletesPerSec: 1 },
        scale: { items: 'medium', writes: 'even', growth: 'slow' },
    },
    ecommerce: {
        containers: [
            container('Orders', '/customerId', [
                key('id'),
                pk('customerId'),
                filter('orderDate', 'string (ISO)'),
                filter('status'),
                payload('totalAmount', 'number'),
                payload('items', 'array'),
            ]),
            container('Customer', '/id', [pk('id'), filter('email'), payload('name'), filter('tier')]),
        ],
        reads: [
            { pattern: l10n.t('Get all orders for a customer'), filters: 'customerId', qps: 80 },
            { pattern: l10n.t('Get order by ID'), filters: 'id', qps: 30 },
        ],
        writes: { insertsPerSec: 15, updatesPerSec: 10, deletesPerSec: 0 },
        scale: { items: 'medium', writes: 'even', growth: 'slow' },
    },
    iot: {
        containers: [
            container('DeviceTelemetry', '/deviceId', [
                key('id'),
                pk('deviceId'),
                filter('timestamp', 'string (ISO)'),
                filter('location'),
                filter('deviceType'),
                payload('temperature', 'number'),
            ]),
        ],
        reads: [{ pattern: l10n.t('Get telemetry for a device in a time range'), filters: 'deviceId', qps: 25 }],
        writes: { insertsPerSec: 2000, updatesPerSec: 0, deletesPerSec: 0 },
        scale: { items: 'high', writes: 'time', growth: 'rapid' },
    },
    multitenant: {
        containers: [
            container('TenantRecord', '/tenantId', [
                key('id'),
                pk('tenantId'),
                filter('entityType'),
                filter('createdAt', 'string (ISO)'),
                filter('plan'),
                payload('payload', 'object'),
            ]),
        ],
        reads: [{ pattern: l10n.t('Get all records for a tenant'), filters: 'tenantId', qps: 60 }],
        writes: { insertsPerSec: 40, updatesPerSec: 20, deletesPerSec: 2 },
        scale: { items: 'high', writes: 'skewed', growth: 'slow' },
    },
    rag: {
        containers: [
            container('DocumentChunk', '/sourceId', [
                key('id'),
                pk('sourceId'),
                filter('chunkIndex', 'number'),
                payload('content'),
                payload('embedding', 'number[]'),
                filter('category'),
            ]),
        ],
        reads: [{ pattern: l10n.t('Get all chunks for a source document'), filters: 'sourceId', qps: 15 }],
        writes: { insertsPerSec: 5, updatesPerSec: 0, deletesPerSec: 0 },
        scale: { items: 'medium', writes: 'even', growth: 'bounded' },
    },
    social: {
        containers: [
            container('Message', '/conversationId', [
                key('id'),
                pk('conversationId'),
                filter('userId'),
                filter('createdAt', 'string (ISO)'),
                payload('body'),
                payload('reactions', 'array'),
            ]),
        ],
        reads: [{ pattern: l10n.t('Get messages in a conversation'), filters: 'conversationId', qps: 200 }],
        writes: { insertsPerSec: 90, updatesPerSec: 10, deletesPerSec: 5 },
        scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
    },
    catalog: {
        containers: [
            container('Product', '/categoryId', [
                key('id'),
                pk('categoryId'),
                filter('sellerId'),
                filter('name'),
                payload('price', 'number'),
                filter('inStock', 'boolean'),
            ]),
        ],
        reads: [{ pattern: l10n.t('List products in a category'), filters: 'categoryId', qps: 300 }],
        writes: { insertsPerSec: 5, updatesPerSec: 15, deletesPerSec: 1 },
        scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
    },
    gaming: {
        containers: [
            container('PlayerState', '/playerId', [
                key('id'),
                pk('playerId'),
                filter('season'),
                payload('score', 'number'),
                filter('matchId'),
                filter('updatedAt', 'string (ISO)'),
            ]),
        ],
        reads: [{ pattern: l10n.t("Get a player's state and match history"), filters: 'playerId', qps: 150 }],
        writes: { insertsPerSec: 40, updatesPerSec: 60, deletesPerSec: 0 },
        scale: { items: 'medium', writes: 'even', growth: 'slow' },
    },
    profiles: {
        containers: [
            container('UserProfile', '/id', [
                pk('id'),
                filter('email'),
                payload('displayName'),
                payload('preferences', 'object'),
                filter('segment'),
                filter('createdAt', 'string (ISO)'),
            ]),
        ],
        reads: [{ pattern: l10n.t('Get a profile by user ID (point read)'), filters: 'id', qps: 500 }],
        writes: { insertsPerSec: 5, updatesPerSec: 20, deletesPerSec: 1 },
        scale: { items: 'low', writes: 'even', growth: 'bounded' },
    },
    eventsourcing: {
        containers: [
            container('DomainEvent', '/streamId', [
                key('id'),
                pk('streamId'),
                filter('sequence', 'number'),
                filter('eventType'),
                filter('occurredAt', 'string (ISO)'),
                payload('data', 'object'),
            ]),
        ],
        reads: [{ pattern: l10n.t('Replay all events for an aggregate/stream'), filters: 'streamId', qps: 20 }],
        writes: { insertsPerSec: 300, updatesPerSec: 0, deletesPerSec: 0 },
        scale: { items: 'medium', writes: 'even', growth: 'slow' },
    },
    analytics: {
        containers: [
            container('ClickEvent', '/sessionId', [
                key('id'),
                pk('sessionId'),
                filter('userId'),
                filter('eventName'),
                payload('url'),
                filter('ts', 'string (ISO)'),
            ]),
        ],
        reads: [{ pattern: l10n.t('Get all events in a session'), filters: 'sessionId', qps: 50 }],
        writes: { insertsPerSec: 1500, updatesPerSec: 0, deletesPerSec: 0 },
        scale: { items: 'medium', writes: 'time', growth: 'slow' },
    },
    cms: {
        containers: [
            container('ContentItem', '/siteId', [
                key('id'),
                pk('siteId'),
                filter('contentType'),
                filter('status'),
                filter('author'),
                filter('updatedAt', 'string (ISO)'),
            ]),
        ],
        reads: [{ pattern: l10n.t('List content for a site/space'), filters: 'siteId', qps: 400 }],
        writes: { insertsPerSec: 3, updatesPerSec: 8, deletesPerSec: 1 },
        scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
    },
    ledger: {
        containers: [
            container('LedgerEntry', '/accountId', [
                key('id'),
                pk('accountId'),
                payload('amount', 'number'),
                filter('currency'),
                filter('type'),
                filter('postedAt', 'string (ISO)'),
            ]),
        ],
        reads: [{ pattern: l10n.t('Get all transactions for an account'), filters: 'accountId', qps: 70 }],
        writes: { insertsPerSec: 50, updatesPerSec: 0, deletesPerSec: 0 },
        scale: { items: 'high', writes: 'skewed', growth: 'slow' },
    },
    inventory: {
        containers: [
            container('StockLevel', '/skuId', [
                key('id'),
                pk('skuId'),
                filter('warehouseId'),
                payload('quantity', 'number'),
                filter('category'),
                filter('updatedAt', 'string (ISO)'),
            ]),
        ],
        reads: [{ pattern: l10n.t('Get stock for a SKU across warehouses'), filters: 'skuId', qps: 90 }],
        writes: { insertsPerSec: 10, updatesPerSec: 40, deletesPerSec: 1 },
        scale: { items: 'low', writes: 'even', growth: 'bounded' },
    },
    booking: {
        containers: [
            container('Reservation', '/propertyId', [
                key('id'),
                pk('propertyId'),
                filter('guestId'),
                filter('checkIn', 'string (ISO)'),
                filter('checkOut', 'string (ISO)'),
                filter('status'),
            ]),
        ],
        reads: [{ pattern: l10n.t('Get reservations for a property/resource'), filters: 'propertyId', qps: 45 }],
        writes: { insertsPerSec: 8, updatesPerSec: 6, deletesPerSec: 2 },
        scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
    },
    other: {
        containers: [
            container('Entity', '/id', [
                pk('id'),
                filter('type'),
                filter('createdAt', 'string (ISO)'),
                payload('data', 'object'),
            ]),
        ],
        reads: [{ pattern: l10n.t('Describe your dominant query'), filters: 'id', qps: 10 }],
        writes: { insertsPerSec: 5, updatesPerSec: 5, deletesPerSec: 0 },
        scale: { items: 'medium', writes: 'even', growth: 'slow' },
    },
};
