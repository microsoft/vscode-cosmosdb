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
import { type ArrayUpdatePattern, type ScenarioId } from './models';

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
