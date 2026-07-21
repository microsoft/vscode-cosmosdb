/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { containerKey } from '../../shared';
import { capacityMaterialitySeverity, clampRationale, mean } from './helpers';
import {
    type DerivedAdvisory,
    type DerivedAdvisoryInputs,
    type DerivedAdvisoryRule,
    type DerivedAdvisorySeverity,
    type DerivedAdvisoryThresholds,
} from './types';

/** The already-fetched telemetry + configured thresholds every detector evaluates against. */
export interface DetectorContext {
    inputs: DerivedAdvisoryInputs;
    thresholds: DerivedAdvisoryThresholds;
}

/**
 * Base class for every derived-advisory detector. Each concrete detector emits exactly one rule, owns its own
 * loop over the slice of {@link DetectorContext} it needs, and returns the advisories that fired. Shared helpers
 * (rationale clamping, capacity-materiality severity, scope keys) live here so every detector stays consistent.
 */
export abstract class Detector {
    /** The single rule this detector emits. */
    abstract readonly rule: DerivedAdvisoryRule;
    /** Rules this detector suppresses on the same scope when it fires (declarative de-duplication, applied by the engine). */
    readonly suppresses: readonly DerivedAdvisoryRule[] = [];
    /** Runs the detector over the full context and returns every advisory it fires. */
    abstract run(ctx: DetectorContext): DerivedAdvisory[];

    protected clampRationale(text: string): string {
        return clampRationale(text);
    }
    protected materialitySeverity(findingRu: number, scopeProvisionedRu: number | undefined): DerivedAdvisorySeverity {
        return capacityMaterialitySeverity(findingRu, scopeProvisionedRu);
    }
    protected mean(values: readonly number[]): number {
        return mean(values);
    }
    protected scope(databaseId: string, containerId: string): string {
        return containerKey(databaseId, containerId);
    }
}
