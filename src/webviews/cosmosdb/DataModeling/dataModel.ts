/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The single, unified structure that captures every input the user provides on the
 * **Data**, **Queries** and **Scale** pages of the wizard, plus the pure helpers that
 * build and derive it.
 *
 * Each page reads its slice from a {@link DataModel} and writes back an updated
 * {@link DataModel}, so all workload input lives in one place instead of being spread
 * across separate wizard-state fields. The **Workload** page seeds a fully pre-filled
 * model per scenario via {@link buildDataModel}.
 *
 * Kept free of React so the same logic can back a future generic wizard package or a
 * host-side seeding step.
 */

import { type ContainerDefault, DATA_MODEL_DEFAULTS } from './dataModelDefaults';
import {
    type ContainerModel,
    type PartitionCandidate,
    type ReadQuery,
    type ScaleProfile,
    type ScenarioId,
    type ScoringWeights,
    type WriteOps,
} from './models';
import { nextId } from './scenarios';

/**
 * All workload input collected by the Data, Queries and Scale pages, in one structure.
 *
 * - {@link containers} / {@link activeContainerId} — Data page (schema, document shape, arrays).
 * - {@link reads} / {@link writes} — Queries page (read patterns and write rates).
 * - {@link scale} — Scale page (cardinality, distribution and growth).
 */
export interface DataModel {
    containers: ContainerModel[];
    activeContainerId?: string;
    reads: ReadQuery[];
    writes: WriteOps;
    scale: ScaleProfile;
}

/** Top-level wizard state: navigation, the chosen scenario, the {@link DataModel}, and scoring weights. */
export interface WizardState {
    step: number;
    scenario?: ScenarioId;
    dataModel: DataModel;
    weights: ScoringWeights;
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

function instantiateContainer(def: ContainerDefault): ContainerModel {
    return {
        id: nextId('container'),
        entity: def.entity,
        partitionKey: def.partitionKey,
        properties: def.properties.map((p) => ({
            id: nextId('prop'),
            name: p.name,
            type: p.type,
            role: p.role,
            pkCandidate: p.pkCandidate,
        })),
        document: { ...def.document },
        arrays: { ...def.arrays },
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

/** The container currently being edited/viewed (falls back to the first one). */
export function getActiveContainer(model: DataModel): ContainerModel | undefined {
    return model.containers.find((c) => c.id === model.activeContainerId) ?? model.containers[0];
}

/** Average document size (KB) of the active container, used for RU/size estimates. */
export function getAvgDocSizeKb(model: DataModel): number {
    return getActiveContainer(model)?.document.avgSizeKb ?? 1;
}

/**
 * Refresh the derived partition-key candidates from the active container's key/filter
 * properties. Call after the schema or active container changes (Data page); leaves the
 * rest of {@link DataModel.scale} untouched so user-edited distinct-value counts survive
 * edits made on the Scale page itself.
 */
export function withDerivedCandidates(model: DataModel): DataModel {
    return { ...model, scale: { ...model.scale, candidates: buildCandidates(getActiveContainer(model)) } };
}

/** Empty model shown before a scenario is chosen. */
export function createEmptyDataModel(): DataModel {
    return {
        containers: [],
        activeContainerId: undefined,
        reads: [],
        writes: { insertsPerSec: 0, updatesPerSec: 0, deletesPerSec: 0 },
        scale: { candidates: [], items: 'medium', writes: 'even', growth: 'slow' },
    };
}

/** Fully pre-filled model built from a scenario's hardcoded defaults (Workload page selection). */
export function buildDataModel(scenario: ScenarioId): DataModel {
    const defaults = DATA_MODEL_DEFAULTS[scenario];
    const containers = defaults.containers.map(instantiateContainer);
    const active = containers[0];
    return {
        containers,
        activeContainerId: active?.id,
        reads: defaults.reads.map((r) => ({ id: nextId('read'), pattern: r.pattern, filters: r.filters, qps: r.qps })),
        writes: { ...defaults.writes },
        scale: {
            candidates: buildCandidates(active),
            items: defaults.scale.items,
            writes: defaults.scale.writes,
            growth: defaults.scale.growth,
        },
    };
}

/** Initial wizard state shown before a scenario is chosen. */
export function createInitialState(): WizardState {
    return {
        step: 1,
        scenario: undefined,
        dataModel: createEmptyDataModel(),
        weights: { read: 35, write: 35, storage: 30 },
    };
}

/** Pre-fill the whole data model from a chosen scenario, preserving step and weights. */
export function applyScenario(state: WizardState, scenario: ScenarioId): WizardState {
    return { ...state, scenario, dataModel: buildDataModel(scenario) };
}
