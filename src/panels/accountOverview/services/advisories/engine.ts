/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DetectorContext } from './core/Detector';
import { compareAdvisories } from './core/helpers';
import {
    type DerivedAdvisory,
    type DerivedAdvisoryAnalysis,
    type DerivedAdvisoryInputs,
    type DerivedAdvisoryThresholds,
    type DetectorCoverage,
    type ScopedCapacityThrottling,
} from './core/types';
import { DETECTORS } from './registry';

/**
 * Runs every registered detector over already-fetched telemetry, applies each detector's declared
 * per-scope supersessions, sorts by severity, and returns every advisory with superseded ones marked.
 * Pure.
 */
export function computeDerivedAdvisories(
    inputs: DerivedAdvisoryInputs,
    thresholds: DerivedAdvisoryThresholds,
): DerivedAdvisory[] {
    return analyzeDerivedAdvisories(inputs, thresholds).advisories;
}

/** Evaluates each rule once and retains coverage before finding suppression. Pure. */
export function analyzeDerivedAdvisories(
    inputs: DerivedAdvisoryInputs,
    thresholds: DerivedAdvisoryThresholds,
): DerivedAdvisoryAnalysis {
    const ctx: DetectorContext = { inputs, thresholds };
    const supersessions = new Map<string, string>();
    const collected: DerivedAdvisory[] = [];
    const detectorCoverage: DetectorCoverage[] = [];
    const capacityThrottling: ScopedCapacityThrottling[] = [];

    for (const detector of DETECTORS) {
        const analysis = detector.analyze(ctx);

        detectorCoverage.push(analysis.coverage);
        capacityThrottling.push(...(analysis.capacityThrottling ?? []));
        for (const advisory of analysis.advisories) {
            collected.push(advisory);
            for (const rule of detector.supersedes) {
                supersessions.set(`${rule}::${advisory.scope ?? ''}`, advisory.rule);
            }
        }
    }

    const result = collected.map((advisory) => {
        const supersededBy = supersessions.get(`${advisory.rule}::${advisory.scope ?? ''}`);

        return supersededBy && supersededBy !== advisory.rule ? { ...advisory, supersededBy } : advisory;
    });

    result.sort(compareAdvisories);

    return { advisories: result, detectorCoverage, ...(capacityThrottling.length > 0 && { capacityThrottling }) };
}
