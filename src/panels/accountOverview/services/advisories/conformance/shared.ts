/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { type ThroughputMode } from '../../inventory';
import {
    type AccountConfigInput,
    type AdvisoryEvaluation,
    type ContainerStorageInput,
    type CrossPartitionInput,
    type DerivedAdvisory,
    type DerivedAdvisoryInputs,
    type IdleContainerInput,
    type IndexingUsageInput,
    type ManualThroughputInput,
    type PartitionMergeInput,
    type ProvisioningEvaluation,
    type RequestErrorEvaluation,
    type SharedThroughputInput,
} from '../core/types';

export interface World {
    inputs: DerivedAdvisoryInputs;
    manual?: ManualThroughputInput;
    autoscale?: { max: number; samples: number; peaks: number[]; shared: boolean; series?: number[][] };
    age?: number;
    statuses?: Record<string, number>;
    result?:
        | ProvisioningEvaluation
        | RequestErrorEvaluation
        | AdvisoryEvaluation
        | { rootCause: 'log_analytics_unavailable' | 'query_error' };
    advisory?: DerivedAdvisory;
    checks: number;
    account: AccountConfigInput;
    requests?: { total: number; throttled: number; mode: ThroughputMode };
    partitionPeaks?: number[];
    queries?: CrossPartitionInput;
    shared?: SharedThroughputInput;
    idle?: IdleContainerInput;
    merge?: PartitionMergeInput;
    storage?: ContainerStorageInput;
    indexing?: IndexingUsageInput;
    indexSeries?: (number | undefined)[];
    dataSeries?: (number | undefined)[];
    hourlyRu?: number[];
    writeRu?: number;
    totalRu?: number;
    operations?: Record<string, number>;
    logFailure?: boolean;
    emptyLogs?: boolean;
    applicabilityMode?: ThroughputMode;
    applicabilityChecked?: boolean;
}

export interface Binding {
    type: 'Context' | 'Action' | 'Outcome';
    pattern: RegExp;
    execute: (world: World, match: RegExpExecArray, detector: string) => void | Promise<void>;
}

export function number(text: string): number {
    const value = Number(text);
    assert.ok(Number.isFinite(value), 'Step parameter must be finite.');
    return value;
}

export function observation(world: World): NonNullable<World['result']> {
    assert.ok(world.result, 'Evaluation must run before assertions.');
    return world.result;
}

export function near(actual: number | undefined, expected: string): void {
    assert.ok(typeof actual === 'number', 'Expected a numeric production observation.');
    const target = number(expected);
    assert.ok(
        Math.abs(actual - target) <= Math.max(1e-12, Math.abs(target) * 1e-6),
        `Expected ${target}, received ${actual}.`,
    );
}

export function observed(world: World, key: string): number | string | boolean | null | undefined {
    const result = observation(world);
    assert.ok('rootCause' in result, 'Expected a production diagnostic evaluation.');
    const observations: Readonly<Record<string, number | string | boolean | null>> | undefined =
        'observations' in result ? result.observations : undefined;
    return observations?.[key];
}

export function throughputMode(token: string, level?: string): ThroughputMode {
    if (token === 'manual') {
        return level === 'database' ? 'shared' : 'dedicated';
    }
    assert.ok(token === 'autoscale' || token === 'serverless' || token === 'shared');
    return token;
}

export function shapedValues(count: number, average: number, peak: number): number[] {
    if (count === 0) {
        return [];
    }
    return Array.from({ length: count }, (_, index) =>
        index === count - 1 ? peak : (average * count - peak) / (count - 1),
    );
}
