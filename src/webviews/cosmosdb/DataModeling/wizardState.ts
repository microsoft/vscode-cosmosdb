/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure helpers that derive wizard state from the fake scenario catalog.
 *
 * Kept free of React so the same logic can back a future generic wizard
 * package or a host-side seeding step.
 */

import * as l10n from '@vscode/l10n';
import {
    type ContainerModel,
    type PartitionCandidate,
    type PropertyRole,
    type ScaleProfile,
    type ScenarioId,
    type WizardState,
} from './models';
import { getScenarioTemplate, nextId, type SeedContainer } from './scenarios';

export interface PropertyRoleOption {
    value: PropertyRole;
    label: string;
}

export function getRoleOptions(): PropertyRoleOption[] {
    return [
        { value: 'key', label: l10n.t('🔑 Unique / business key') },
        { value: 'filter', label: l10n.t('🔎 Query filter') },
        { value: 'payload', label: l10n.t('📄 Payload / other') },
    ];
}

/** Rough cardinality guess from a property name, used to pre-fill the Scale page. */
function estimateDistinctValues(name: string): number {
    const lower = name.toLowerCase();
    if (lower === 'id' || lower.endsWith('id')) {
        return 500000;
    }
    if (lower.includes('date') || lower.includes('time') || lower.endsWith('at')) {
        return 3650;
    }
    if (lower.includes('type') || lower.includes('status') || lower.includes('role') || lower.includes('category')) {
        return 25;
    }
    return 1000;
}

function seedToContainer(seed: SeedContainer): ContainerModel {
    return {
        id: nextId('container'),
        entity: seed.entity,
        partitionKey: seed.partitionKey,
        properties: seed.properties.map((p) => ({
            id: nextId('prop'),
            name: p.name,
            type: p.type,
            role: p.role,
            pkCandidate: p.pkCandidate,
        })),
        document: { attributeCount: 12, avgSizeKb: 2, maxSizeKb: 8 },
        arrays: { hasArrays: false, avgItems: 10, maxItems: 100, updatePattern: 'none' },
    };
}

/** Build the partition-key candidate rows for the Scale page from a container. */
export function buildCandidates(container: ContainerModel | undefined): PartitionCandidate[] {
    if (!container) {
        return [];
    }
    return container.properties
        .filter((p) => p.role === 'key' || p.role === 'filter')
        .map((p) => ({
            id: nextId('cand'),
            attribute: p.name,
            role: p.role,
            distinctValues: estimateDistinctValues(p.name),
        }));
}

/** Initial, empty-ish state shown before a scenario is chosen. */
export function createInitialState(): WizardState {
    return {
        step: 1,
        scenario: undefined,
        containers: [],
        activeContainerId: undefined,
        reads: [],
        writes: { insertsPerSec: 0, updatesPerSec: 0, deletesPerSec: 0 },
        scale: { candidates: [], items: 'medium', writes: 'even', growth: 'slow' },
        weights: { read: 35, write: 35, storage: 30 },
    };
}

/** Pre-fill the whole wizard from a chosen scenario, preserving the step. */
export function applyScenario(state: WizardState, scenario: ScenarioId): WizardState {
    const template = getScenarioTemplate(scenario);
    const containers = template.containers.map(seedToContainer);
    const active = containers[0];
    const scale: ScaleProfile = {
        candidates: buildCandidates(active),
        items: template.scale.items,
        writes: template.scale.writes,
        growth: template.scale.growth,
    };

    return {
        ...state,
        scenario,
        containers,
        activeContainerId: active?.id,
        reads: template.reads.map((r) => ({ id: nextId('read'), ...r })),
        writes: template.writes,
        scale,
    };
}

export function getActiveContainer(state: WizardState): ContainerModel | undefined {
    return state.containers.find((c) => c.id === state.activeContainerId) ?? state.containers[0];
}
