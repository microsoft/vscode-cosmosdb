/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isEqual } from 'es-toolkit';
import { type DataModel, type WizardState } from '../webviews/cosmosdb/DataModeling/dataModel';
import { type ContainerDefault, DATA_MODEL_DEFAULTS } from '../webviews/cosmosdb/DataModeling/dataModelDefaults';
import { type ContainerModel, type ScenarioId } from '../webviews/cosmosdb/DataModeling/models';

type ModelingSection = 'data' | 'queries' | 'scale';

function containerInputs(container: ContainerModel) {
    return {
        data: {
            entity: container.entity,
            partitionKey: container.partitionKey,
            properties: container.properties.map(({ id: _id, ...property }) => property),
            document: container.document,
            arrays: container.arrays,
        },
        queries: { reads: container.reads.map(({ id: _id, ...read }) => read), writes: container.writes },
        scale: {
            ...container.scale,
            candidates: container.scale.candidates.map(({ id: _id, ...candidate }) => candidate),
        },
    };
}

/**
 * Compare semantic inputs locally, ignoring generated IDs and active selection.
 * Container order remains significant; no file contents, paths, or names are emitted.
 */
export function modelingInputsEqual(a: DataModel, b: DataModel): boolean {
    return isEqual(a.containers.map(containerInputs), b.containers.map(containerInputs));
}

/**
 * Mirrors dataModel's fallback estimates without invoking its ID-generating builders.
 * Catalog cardinalities take precedence; all scenarios are tested against their instantiated defaults.
 */
function defaultCardinality(name: string): number {
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

function defaultInputs(container: ContainerDefault): ReturnType<typeof containerInputs> {
    return {
        data: {
            entity: container.entity,
            partitionKey: container.partitionKey,
            properties: container.properties.map(({ distinctValues: _distinctValues, ...property }) => property),
            document: container.document,
            arrays: container.arrays,
        },
        queries: { reads: container.reads, writes: container.writes },
        scale: {
            ...container.scale,
            candidates: container.properties
                .filter((property) => property.role === 'key' || property.role === 'filter')
                .map((property) => ({
                    attribute: property.name,
                    role: property.role,
                    distinctValues: property.distinctValues ?? defaultCardinality(property.name),
                })),
        },
    };
}

/**
 * Summarize current semantic differences, not edit history: no file contents, paths, or names are emitted.
 * IDs and navigation stay local and are ignored. Container order is significant, as in recommendationContext.
 * Customized containers count current containers that differ from the default at the same position;
 * removed containers affect section differences but are not counted as current customized containers.
 */
export function summarizeModel(wizard: WizardState): {
    scenario: ScenarioId | 'none';
    differsFromDefault: boolean;
    dataChanged: boolean;
    queriesChanged: boolean;
    scaleChanged: boolean;
    containerCount: number;
    propertyCount: number;
    queryCount: number;
    customizedContainerCount: number;
} {
    const containers = wizard.dataModel.containers;
    const current = containers.map(containerInputs);
    const defaults = wizard.scenario ? DATA_MODEL_DEFAULTS[wizard.scenario].containers.map(defaultInputs) : [];
    const sectionChanged = (section: ModelingSection) =>
        !isEqual(
            current.map((container) => container[section]),
            defaults.map((container) => container[section]),
        );
    const dataChanged = sectionChanged('data');
    const queriesChanged = sectionChanged('queries');
    const scaleChanged = sectionChanged('scale');
    return {
        scenario: wizard.scenario ?? 'none',
        differsFromDefault: dataChanged || queriesChanged || scaleChanged,
        dataChanged,
        queriesChanged,
        scaleChanged,
        containerCount: containers.length,
        propertyCount: containers.reduce((count, container) => count + container.properties.length, 0),
        queryCount: containers.reduce((count, container) => count + container.reads.length, 0),
        customizedContainerCount: current.filter((container, index) => !isEqual(container, defaults[index])).length,
    };
}

/**
 * Summarize actual section visits for current containers: no file contents, paths, or names are emitted.
 * Container IDs remain local; removed containers and repeated visits cannot inflate counts or coverage.
 */
export function summarizeCoverage(
    containerIds: readonly string[],
    visits: ReadonlyMap<string, ReadonlySet<ModelingSection>>,
) {
    const count = (section: ModelingSection) => containerIds.filter((id) => visits.get(id)?.has(section)).length;
    const ratio = (viewed: number) =>
        containerIds.length ? Math.round((viewed / containerIds.length) * 1000) / 1000 : 0;
    const dataViewedCount = count('data');
    const queriesViewedCount = count('queries');
    const scaleViewedCount = count('scale');
    return {
        dataViewedCount,
        queriesViewedCount,
        scaleViewedCount,
        dataNeverViewedCount: containerIds.length - dataViewedCount,
        queriesNeverViewedCount: containerIds.length - queriesViewedCount,
        scaleNeverViewedCount: containerIds.length - scaleViewedCount,
        dataCoverage: ratio(dataViewedCount),
        queriesCoverage: ratio(queriesViewedCount),
        scaleCoverage: ratio(scaleViewedCount),
    };
}
