/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Fake, in-webview catalog data for the Data-Modeling wizard prototype.
 *
 * None of this talks to Cosmos DB — it is sample content used to pre-fill the
 * pages so the UI can be exercised end to end. When the wizard is wired to a
 * real backend, these tables become the seed/defaults returned by the host.
 */

import * as l10n from '@vscode/l10n';
import {
    type ArrayUpdatePattern,
    type DataGrowth,
    type ItemsPerPartition,
    type PropertyRole,
    type PropertyType,
    type ScenarioId,
    type WriteDistribution,
} from './models';

let idCounter = 0;
/** Stable-enough unique id for prototype rows (no crypto needed in the webview). */
export function nextId(prefix = 'id'): string {
    idCounter += 1;
    return `${prefix}-${idCounter}`;
}

export interface ScenarioBadge {
    tone: 'info' | 'warn' | 'success';
    text: string;
}

export interface ScenarioListItem {
    id: ScenarioId;
    title: string;
    description: string;
    badge: ScenarioBadge;
    hint: string;
    searchTerms: string;
}

/** The pickable workload patterns shown on the Workload page. */
export function getScenarioList(): ScenarioListItem[] {
    return [
        {
            id: 'chat',
            title: l10n.t('Chat & Sessions'),
            description: l10n.t('Chat sessions, AI assistants, helpdesks'),
            badge: { tone: 'info', text: l10n.t('Low latency') },
            hint: '/sessionId · /userId',
            searchTerms: 'chat sessions ai assistant helpdesk',
        },
        {
            id: 'ecommerce',
            title: l10n.t('Orders & Transactions'),
            description: l10n.t('Checkout, payments, subscription records'),
            badge: { tone: 'info', text: l10n.t('Transactional') },
            hint: '/customerId',
            searchTerms: 'orders transactions checkout retail e-commerce',
        },
        {
            id: 'iot',
            title: l10n.t('IoT Device Telemetry'),
            description: l10n.t('High-volume device events, sensor streams'),
            badge: { tone: 'warn', text: l10n.t('Write-heavy') },
            hint: '/deviceId (+ /date)',
            searchTerms: 'iot telemetry devices sensors time-series',
        },
        {
            id: 'multitenant',
            title: l10n.t('Multi-tenant SaaS'),
            description: l10n.t('Tenant-isolated data, variable tenant sizes'),
            badge: { tone: 'info', text: l10n.t('Tenant isolation') },
            hint: '/tenantId (+ HPK)',
            searchTerms: 'multi-tenant saas b2b tenant isolation',
        },
        {
            id: 'rag',
            title: l10n.t('RAG & Embeddings'),
            description: l10n.t('AI knowledge bases, document search, vectors'),
            badge: { tone: 'warn', text: l10n.t('Large docs') },
            hint: '/categoryId · /sourceId',
            searchTerms: 'rag embeddings vector ai knowledge base',
        },
        {
            id: 'social',
            title: l10n.t('Social & Messaging'),
            description: l10n.t('Posts, feeds, conversations, user interactions'),
            badge: { tone: 'success', text: l10n.t('Fan-out reads') },
            hint: '/userId · /conversationId',
            searchTerms: 'social messaging feeds posts conversations',
        },
        {
            id: 'catalog',
            title: l10n.t('Product Catalog'),
            description: l10n.t('Listings, inventory, marketplace items'),
            badge: { tone: 'success', text: l10n.t('Cacheable') },
            hint: '/categoryId · /sellerId',
            searchTerms: 'product catalog inventory marketplace',
        },
        {
            id: 'gaming',
            title: l10n.t('Gaming & Leaderboards'),
            description: l10n.t('Player state, match history, leaderboards'),
            badge: { tone: 'info', text: l10n.t('Low latency') },
            hint: '/playerId',
            searchTerms: 'gaming leaderboards player match',
        },
        {
            id: 'profiles',
            title: l10n.t('User Profiles & Identity'),
            description: l10n.t('Accounts, preferences, settings'),
            badge: { tone: 'success', text: l10n.t('Point reads') },
            hint: '/id (userId)',
            searchTerms: 'user profiles identity accounts preferences settings',
        },
        {
            id: 'eventsourcing',
            title: l10n.t('Event Sourcing & Audit'),
            description: l10n.t('Immutable event streams, audit logs'),
            badge: { tone: 'info', text: l10n.t('Append-only') },
            hint: '/streamId',
            searchTerms: 'event sourcing audit immutable log stream',
        },
        {
            id: 'analytics',
            title: l10n.t('Real-time Analytics'),
            description: l10n.t('Clickstream, sessions, funnels'),
            badge: { tone: 'warn', text: l10n.t('Write-heavy') },
            hint: '/sessionId',
            searchTerms: 'real-time analytics clickstream sessions funnels',
        },
        {
            id: 'cms',
            title: l10n.t('Content Management'),
            description: l10n.t('Articles, pages, media metadata'),
            badge: { tone: 'success', text: l10n.t('Read-heavy') },
            hint: '/siteId · /contentId',
            searchTerms: 'content management articles pages media cms',
        },
        {
            id: 'ledger',
            title: l10n.t('Financial Ledger'),
            description: l10n.t('Accounts, transactions, payments'),
            badge: { tone: 'info', text: l10n.t('Transactional') },
            hint: '/accountId',
            searchTerms: 'financial ledger accounts transactions payments',
        },
        {
            id: 'inventory',
            title: l10n.t('Inventory & Supply Chain'),
            description: l10n.t('SKUs, stock levels, warehouses'),
            badge: { tone: 'success', text: l10n.t('Balanced') },
            hint: '/skuId (+ HPK)',
            searchTerms: 'inventory supply chain sku stock warehouse',
        },
        {
            id: 'booking',
            title: l10n.t('Booking & Reservations'),
            description: l10n.t('Properties, resources, availability'),
            badge: { tone: 'success', text: l10n.t('Balanced') },
            hint: '/propertyId',
            searchTerms: 'booking reservations property resource availability',
        },
        {
            id: 'other',
            title: l10n.t('None of these fit'),
            description: l10n.t('Describe your specific workload'),
            badge: { tone: 'info', text: l10n.t('Custom') },
            hint: '',
            searchTerms: 'other custom none',
        },
    ];
}

export interface SeedProperty {
    name: string;
    type: PropertyType;
    role: PropertyRole;
    pkCandidate: boolean;
}

export interface SeedContainer {
    entity: string;
    partitionKey: string;
    properties: SeedProperty[];
}

export interface ScenarioTemplate {
    label: string;
    /** Primary container plus any sibling containers the workload spans. */
    containers: SeedContainer[];
    queries: { primary: string; secondary: string; rare: string };
    reads: { pattern: string; filters: string; qps: number }[];
    writes: { insertsPerSec: number; updatesPerSec: number; deletesPerSec: number };
    scale: {
        items: ItemsPerPartition;
        writes: WriteDistribution;
        growth: DataGrowth;
    };
}

const key = (name: string, type: PropertyType = 'string'): SeedProperty => ({
    name,
    type,
    role: 'key',
    pkCandidate: false,
});
const filter = (name: string, type: PropertyType = 'string'): SeedProperty => ({
    name,
    type,
    role: 'filter',
    pkCandidate: false,
});
const payload = (name: string, type: PropertyType = 'string'): SeedProperty => ({
    name,
    type,
    role: 'payload',
    pkCandidate: false,
});
const pk = (name: string, type: PropertyType = 'string'): SeedProperty => ({
    name,
    type,
    role: 'key',
    pkCandidate: true,
});

/** Per-scenario seed templates. Only a representative subset carries siblings. */
export function getScenarioTemplate(id: ScenarioId): ScenarioTemplate {
    const templates: Record<ScenarioId, ScenarioTemplate> = {
        chat: {
            label: l10n.t('Chat & Sessions'),
            containers: [
                {
                    entity: 'ChatSession',
                    partitionKey: '/sessionId',
                    properties: [
                        key('id'),
                        pk('sessionId'),
                        filter('userId'),
                        filter('timestamp', 'string (ISO)'),
                        filter('role'),
                        payload('content'),
                    ],
                },
                {
                    entity: 'Message',
                    partitionKey: '/sessionId',
                    properties: [
                        key('id'),
                        pk('sessionId'),
                        filter('role'),
                        payload('content'),
                        payload('tokens', 'number'),
                        filter('timestamp', 'string (ISO)'),
                    ],
                },
                {
                    entity: 'User',
                    partitionKey: '/id',
                    properties: [pk('id'), filter('email'), payload('displayName'), filter('plan')],
                },
            ],
            queries: {
                primary: l10n.t('Get all messages in a session'),
                secondary: l10n.t("List a user's recent sessions"),
                rare: l10n.t('Full-text search across messages (admin)'),
            },
            reads: [
                { pattern: l10n.t('Get all messages in a session'), filters: 'sessionId', qps: 120 },
                { pattern: l10n.t("List a user's recent sessions"), filters: 'userId', qps: 40 },
            ],
            writes: { insertsPerSec: 30, updatesPerSec: 5, deletesPerSec: 1 },
            scale: { items: 'medium', writes: 'even', growth: 'slow' },
        },
        ecommerce: {
            label: l10n.t('Orders & Transactions'),
            containers: [
                {
                    entity: 'Orders',
                    partitionKey: '/customerId',
                    properties: [
                        key('id'),
                        pk('customerId'),
                        filter('orderDate', 'string (ISO)'),
                        filter('status'),
                        payload('totalAmount', 'number'),
                        payload('items', 'array'),
                    ],
                },
                {
                    entity: 'Customer',
                    partitionKey: '/id',
                    properties: [pk('id'), filter('email'), payload('name'), filter('tier')],
                },
            ],
            queries: {
                primary: l10n.t('Get all orders for a customer'),
                secondary: l10n.t('Get order by ID'),
                rare: l10n.t('All pending orders (admin dashboard)'),
            },
            reads: [
                { pattern: l10n.t('Get all orders for a customer'), filters: 'customerId', qps: 80 },
                { pattern: l10n.t('Get order by ID'), filters: 'id', qps: 30 },
            ],
            writes: { insertsPerSec: 15, updatesPerSec: 10, deletesPerSec: 0 },
            scale: { items: 'medium', writes: 'even', growth: 'slow' },
        },
        iot: {
            label: l10n.t('IoT Telemetry'),
            containers: [
                {
                    entity: 'DeviceTelemetry',
                    partitionKey: '/deviceId',
                    properties: [
                        key('id'),
                        pk('deviceId'),
                        filter('timestamp', 'string (ISO)'),
                        filter('location'),
                        filter('deviceType'),
                        payload('temperature', 'number'),
                    ],
                },
            ],
            queries: {
                primary: l10n.t('Get telemetry for a device in a time range'),
                secondary: l10n.t('Latest reading per device'),
                rare: l10n.t('Aggregate readings across a site (batch)'),
            },
            reads: [{ pattern: l10n.t('Get telemetry for a device in a time range'), filters: 'deviceId', qps: 25 }],
            writes: { insertsPerSec: 2000, updatesPerSec: 0, deletesPerSec: 0 },
            scale: { items: 'high', writes: 'time', growth: 'rapid' },
        },
        multitenant: {
            label: l10n.t('Multi-tenant SaaS'),
            containers: [
                {
                    entity: 'TenantRecord',
                    partitionKey: '/tenantId',
                    properties: [
                        key('id'),
                        pk('tenantId'),
                        filter('entityType'),
                        filter('createdAt', 'string (ISO)'),
                        filter('plan'),
                        payload('payload', 'object'),
                    ],
                },
            ],
            queries: {
                primary: l10n.t('Get all records for a tenant'),
                secondary: l10n.t('Get a record by ID within a tenant'),
                rare: l10n.t('Cross-tenant usage report (admin)'),
            },
            reads: [{ pattern: l10n.t('Get all records for a tenant'), filters: 'tenantId', qps: 60 }],
            writes: { insertsPerSec: 40, updatesPerSec: 20, deletesPerSec: 2 },
            scale: { items: 'high', writes: 'skewed', growth: 'slow' },
        },
        rag: {
            label: l10n.t('RAG & Embeddings'),
            containers: [
                {
                    entity: 'DocumentChunk',
                    partitionKey: '/sourceId',
                    properties: [
                        key('id'),
                        pk('sourceId'),
                        filter('chunkIndex', 'number'),
                        payload('content'),
                        payload('embedding', 'number[]'),
                        filter('category'),
                    ],
                },
            ],
            queries: {
                primary: l10n.t('Get all chunks for a source document'),
                secondary: l10n.t('Vector search within a source or category'),
                rare: l10n.t('Get a chunk by ID'),
            },
            reads: [{ pattern: l10n.t('Get all chunks for a source document'), filters: 'sourceId', qps: 15 }],
            writes: { insertsPerSec: 5, updatesPerSec: 0, deletesPerSec: 0 },
            scale: { items: 'medium', writes: 'even', growth: 'bounded' },
        },
        social: {
            label: l10n.t('Social & Messaging'),
            containers: [
                {
                    entity: 'Message',
                    partitionKey: '/conversationId',
                    properties: [
                        key('id'),
                        pk('conversationId'),
                        filter('userId'),
                        filter('createdAt', 'string (ISO)'),
                        payload('body'),
                        payload('reactions', 'array'),
                    ],
                },
            ],
            queries: {
                primary: l10n.t('Get messages in a conversation'),
                secondary: l10n.t("Get a user's posts / feed"),
                rare: l10n.t('Trending / global timeline (batch)'),
            },
            reads: [{ pattern: l10n.t('Get messages in a conversation'), filters: 'conversationId', qps: 200 }],
            writes: { insertsPerSec: 90, updatesPerSec: 10, deletesPerSec: 5 },
            scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
        },
        catalog: {
            label: l10n.t('Product Catalog'),
            containers: [
                {
                    entity: 'Product',
                    partitionKey: '/categoryId',
                    properties: [
                        key('id'),
                        pk('categoryId'),
                        filter('sellerId'),
                        filter('name'),
                        payload('price', 'number'),
                        filter('inStock', 'boolean'),
                    ],
                },
            ],
            queries: {
                primary: l10n.t('List products in a category'),
                secondary: l10n.t('Get product by ID'),
                rare: l10n.t('Search across the whole catalog'),
            },
            reads: [{ pattern: l10n.t('List products in a category'), filters: 'categoryId', qps: 300 }],
            writes: { insertsPerSec: 5, updatesPerSec: 15, deletesPerSec: 1 },
            scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
        },
        gaming: {
            label: l10n.t('Gaming & Leaderboards'),
            containers: [
                {
                    entity: 'PlayerState',
                    partitionKey: '/playerId',
                    properties: [
                        key('id'),
                        pk('playerId'),
                        filter('season'),
                        payload('score', 'number'),
                        filter('matchId'),
                        filter('updatedAt', 'string (ISO)'),
                    ],
                },
            ],
            queries: {
                primary: l10n.t("Get a player's state and match history"),
                secondary: l10n.t('Get player by ID (point read)'),
                rare: l10n.t('Top-N global leaderboard (precomputed)'),
            },
            reads: [{ pattern: l10n.t("Get a player's state and match history"), filters: 'playerId', qps: 150 }],
            writes: { insertsPerSec: 40, updatesPerSec: 60, deletesPerSec: 0 },
            scale: { items: 'medium', writes: 'even', growth: 'slow' },
        },
        profiles: {
            label: l10n.t('User Profiles & Identity'),
            containers: [
                {
                    entity: 'UserProfile',
                    partitionKey: '/id',
                    properties: [
                        pk('id'),
                        filter('email'),
                        payload('displayName'),
                        payload('preferences', 'object'),
                        filter('segment'),
                        filter('createdAt', 'string (ISO)'),
                    ],
                },
            ],
            queries: {
                primary: l10n.t('Get a profile by user ID (point read)'),
                secondary: l10n.t('Look up profile by email'),
                rare: l10n.t('List users in a segment (admin)'),
            },
            reads: [{ pattern: l10n.t('Get a profile by user ID (point read)'), filters: 'id', qps: 500 }],
            writes: { insertsPerSec: 5, updatesPerSec: 20, deletesPerSec: 1 },
            scale: { items: 'low', writes: 'even', growth: 'bounded' },
        },
        eventsourcing: {
            label: l10n.t('Event Sourcing & Audit'),
            containers: [
                {
                    entity: 'DomainEvent',
                    partitionKey: '/streamId',
                    properties: [
                        key('id'),
                        pk('streamId'),
                        filter('sequence', 'number'),
                        filter('eventType'),
                        filter('occurredAt', 'string (ISO)'),
                        payload('data', 'object'),
                    ],
                },
            ],
            queries: {
                primary: l10n.t('Replay all events for an aggregate/stream'),
                secondary: l10n.t('Get an event by ID'),
                rare: l10n.t('Audit query over a time range (compliance)'),
            },
            reads: [{ pattern: l10n.t('Replay all events for an aggregate/stream'), filters: 'streamId', qps: 20 }],
            writes: { insertsPerSec: 300, updatesPerSec: 0, deletesPerSec: 0 },
            scale: { items: 'medium', writes: 'even', growth: 'slow' },
        },
        analytics: {
            label: l10n.t('Real-time Analytics'),
            containers: [
                {
                    entity: 'ClickEvent',
                    partitionKey: '/sessionId',
                    properties: [
                        key('id'),
                        pk('sessionId'),
                        filter('userId'),
                        filter('eventName'),
                        payload('url'),
                        filter('ts', 'string (ISO)'),
                    ],
                },
            ],
            queries: {
                primary: l10n.t('Get all events in a session'),
                secondary: l10n.t("Reconstruct a user's funnel"),
                rare: l10n.t('Global aggregates / rollups (batch)'),
            },
            reads: [{ pattern: l10n.t('Get all events in a session'), filters: 'sessionId', qps: 50 }],
            writes: { insertsPerSec: 1500, updatesPerSec: 0, deletesPerSec: 0 },
            scale: { items: 'medium', writes: 'time', growth: 'slow' },
        },
        cms: {
            label: l10n.t('Content Management'),
            containers: [
                {
                    entity: 'ContentItem',
                    partitionKey: '/siteId',
                    properties: [
                        key('id'),
                        pk('siteId'),
                        filter('contentType'),
                        filter('status'),
                        filter('author'),
                        filter('updatedAt', 'string (ISO)'),
                    ],
                },
            ],
            queries: {
                primary: l10n.t('List content for a site/space'),
                secondary: l10n.t('Get a content item by ID'),
                rare: l10n.t('Search published content across sites'),
            },
            reads: [{ pattern: l10n.t('List content for a site/space'), filters: 'siteId', qps: 400 }],
            writes: { insertsPerSec: 3, updatesPerSec: 8, deletesPerSec: 1 },
            scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
        },
        ledger: {
            label: l10n.t('Financial Ledger'),
            containers: [
                {
                    entity: 'LedgerEntry',
                    partitionKey: '/accountId',
                    properties: [
                        key('id'),
                        pk('accountId'),
                        payload('amount', 'number'),
                        filter('currency'),
                        filter('type'),
                        filter('postedAt', 'string (ISO)'),
                    ],
                },
            ],
            queries: {
                primary: l10n.t('Get all transactions for an account'),
                secondary: l10n.t('Get a transaction by ID'),
                rare: l10n.t('Daily reconciliation report (batch)'),
            },
            reads: [{ pattern: l10n.t('Get all transactions for an account'), filters: 'accountId', qps: 70 }],
            writes: { insertsPerSec: 50, updatesPerSec: 0, deletesPerSec: 0 },
            scale: { items: 'high', writes: 'skewed', growth: 'slow' },
        },
        inventory: {
            label: l10n.t('Inventory & Supply Chain'),
            containers: [
                {
                    entity: 'StockLevel',
                    partitionKey: '/skuId',
                    properties: [
                        key('id'),
                        pk('skuId'),
                        filter('warehouseId'),
                        payload('quantity', 'number'),
                        filter('category'),
                        filter('updatedAt', 'string (ISO)'),
                    ],
                },
            ],
            queries: {
                primary: l10n.t('Get stock for a SKU across warehouses'),
                secondary: l10n.t('Get stock for a SKU in one warehouse'),
                rare: l10n.t('Low-stock report per warehouse (batch)'),
            },
            reads: [{ pattern: l10n.t('Get stock for a SKU across warehouses'), filters: 'skuId', qps: 90 }],
            writes: { insertsPerSec: 10, updatesPerSec: 40, deletesPerSec: 1 },
            scale: { items: 'low', writes: 'even', growth: 'bounded' },
        },
        booking: {
            label: l10n.t('Booking & Reservations'),
            containers: [
                {
                    entity: 'Reservation',
                    partitionKey: '/propertyId',
                    properties: [
                        key('id'),
                        pk('propertyId'),
                        filter('guestId'),
                        filter('checkIn', 'string (ISO)'),
                        filter('checkOut', 'string (ISO)'),
                        filter('status'),
                    ],
                },
            ],
            queries: {
                primary: l10n.t('Get reservations for a property/resource'),
                secondary: l10n.t('Get a reservation by ID'),
                rare: l10n.t('Availability across a date range'),
            },
            reads: [{ pattern: l10n.t('Get reservations for a property/resource'), filters: 'propertyId', qps: 45 }],
            writes: { insertsPerSec: 8, updatesPerSec: 6, deletesPerSec: 2 },
            scale: { items: 'medium', writes: 'skewed', growth: 'slow' },
        },
        other: {
            label: l10n.t('Custom workload'),
            containers: [
                {
                    entity: 'Entity',
                    partitionKey: '/id',
                    properties: [
                        pk('id'),
                        filter('type'),
                        filter('createdAt', 'string (ISO)'),
                        payload('data', 'object'),
                    ],
                },
            ],
            queries: {
                primary: l10n.t('Describe your dominant query'),
                secondary: l10n.t('Describe a secondary query'),
                rare: l10n.t('Describe a rare / batch query'),
            },
            reads: [{ pattern: l10n.t('Describe your dominant query'), filters: 'id', qps: 10 }],
            writes: { insertsPerSec: 5, updatesPerSec: 5, deletesPerSec: 0 },
            scale: { items: 'medium', writes: 'even', growth: 'slow' },
        },
    };

    return templates[id];
}

export interface ArrayUpdateOption {
    value: ArrayUpdatePattern;
    label: string;
}

export function getArrayUpdateOptions(): ArrayUpdateOption[] {
    return [
        { value: 'none', label: l10n.t('Rarely updated after write') },
        { value: 'append', label: l10n.t('Append-only (add new items)') },
        { value: 'patch', label: l10n.t('Patch individual elements') },
        { value: 'replace', label: l10n.t('Replace whole array on update') },
    ];
}
