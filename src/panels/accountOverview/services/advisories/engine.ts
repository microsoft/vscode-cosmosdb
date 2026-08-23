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
 * per-scope suppressions, sorts by severity, and returns the surviving advisories. Pure.
 */
export function computeDerivedAdvisories(
    inputs: DerivedAdvisoryInputs,
    thresholds: DerivedAdvisoryThresholds,
): DerivedAdvisory[] {
    const ctx: DetectorContext = { inputs, thresholds };
    const suppressed = new Set<string>();
    const collected: DerivedAdvisory[] = [];
    for (const detector of DETECTORS) {
        for (const advisory of detector.run(ctx)) {
            collected.push(advisory);
            for (const rule of detector.suppresses) {
                suppressed.add(`${rule}::${advisory.scope ?? ''}`);
            }
        }
    }
    const result = collected.filter((a) => !suppressed.has(`${a.rule}::${a.scope ?? ''}`));
    result.sort(compareAdvisories);
    return result;
}
