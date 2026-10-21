/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DetectorContext } from './core/Detector';
import { compareAdvisories } from './core/helpers';
import { type DerivedAdvisory, type DerivedAdvisoryInputs, type DerivedAdvisoryThresholds } from './core/types';
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
    const ctx: DetectorContext = { inputs, thresholds };
    const supersessions = new Map<string, string>();
    const collected: DerivedAdvisory[] = [];
    for (const detector of DETECTORS) {
        for (const advisory of detector.run(ctx)) {
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
    return result;
}
