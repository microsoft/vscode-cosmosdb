/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The unified structure that captures every input the user provides on the **Data**,
 * **Queries** and **Scale** pages of the wizard, plus the pure helpers that build and derive it.
 *
 * The Data, Queries and Scale pages are all **per-container**: each {@link ContainerModel}
 * carries its own schema, document shape, array profile, read patterns, write rates, and scale
 * characteristics. A {@link DataModel} is therefore just the list of containers plus which one is
 * active. The **Workload** page seeds a fully pre-filled model per scenario via
 * {@link buildDataModel}.
 *
 * Kept free of React so the same logic can back a future generic wizard package or a
 * host-side seeding step.
 */

import { type ContainerDefault, DATA_MODEL_DEFAULTS } from './dataModelDefaults';
import { type ContainerModel, type PartitionCandidate, type ScenarioId, type ScoringWeights } from './models';
import { nextId } from './scenarios';

/**
 * All workload input collected by the Data, Queries and Scale pages. Everything is per-container,
 * so this is just the container list plus the active selection.
 */
export interface DataModel {
    containers: ContainerModel[];
    activeContainerId?: string;
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

/** Build the partition-key candidate rows for the Scale page from a container's schema. */
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

function instantiateContainer(def: ContainerDefault): ContainerModel {
    const properties = def.properties.map((p) => ({
        id: nextId('prop'),
        name: p.name,
        type: p.type,
        role: p.role,
        pkCandidate: p.pkCandidate,
    }));
    return {
        id: nextId('container'),
        entity: def.entity,
        partitionKey: def.partitionKey,
        properties,
        document: { ...def.document },
        arrays: { ...def.arrays },
        reads: def.reads.map((r) => ({ id: nextId('read'), pattern: r.pattern, filters: r.filters, qps: r.qps })),
        writes: { ...def.writes },
        scale: {
            candidates: buildCandidates({ properties } as ContainerModel),
            items: def.scale.items,
            writes: def.scale.writes,
            growth: def.scale.growth,
        },
    };
}

/** The container currently being edited/viewed (falls back to the first one). */
export function getActiveContainer(model: DataModel): ContainerModel | undefined {
    return model.containers.find((c) => c.id === model.activeContainerId) ?? model.containers[0];
}

/** Average document size (KB) of the active container, used for RU/size estimates. */
export function getAvgDocSizeKb(model: DataModel): number {
    return getActiveContainer(model)?.document.avgSizeKb ?? 1;
}

/** Replace the active container in the model with an updated copy. */
export function updateActiveContainer(model: DataModel, updater: (c: ContainerModel) => ContainerModel): DataModel {
    const active = getActiveContainer(model);
    if (!active) {
        return model;
    }
    return { ...model, containers: model.containers.map((c) => (c.id === active.id ? updater(c) : c)) };
}

/**
 * Refresh the active container's derived partition-key candidates from its key/filter properties.
 * Call after the schema or active container changes (Data page); leaves the rest of the
 * container's scale untouched so user-edited distinct-value counts survive Scale-page edits.
 */
export function withDerivedCandidates(model: DataModel): DataModel {
    return updateActiveContainer(model, (c) => ({
        ...c,
        scale: { ...c.scale, candidates: buildCandidates(c) },
    }));
}

/** Empty model shown before a scenario is chosen. */
export function createEmptyDataModel(): DataModel {
    return { containers: [], activeContainerId: undefined };
}

/** Fully pre-filled model built from a scenario's hardcoded defaults (Workload page selection). */
export function buildDataModel(scenario: ScenarioId): DataModel {
    const containers = DATA_MODEL_DEFAULTS[scenario].containers.map(instantiateContainer);
    return { containers, activeContainerId: containers[0]?.id };
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
