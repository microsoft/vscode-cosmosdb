/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PickleStep } from '@cucumber/messages';
import assert from 'node:assert/strict';
import { API } from '../../../../../AzureDBExperiences';
import { DEFAULT_ADVISORY_THRESHOLDS } from '../core/thresholds';
import { type ProvisioningEvaluation, type RequestErrorEvaluation } from '../core/types';
import { autoscaleMaxOverProvisionedDetector } from '../detectors/AutoscaleMaxOverProvisionedDetector';
import { nonThrottlingErrorsDetector } from '../detectors/NonThrottlingErrorsDetector';
import { overProvisioningDetector } from '../detectors/OverProvisioningDetector';
import { computeDerivedAdvisories } from '../engine';
import { getAutoscaleUtilization } from '../fetchers/metrics';
import { ACTION_DETECTORS, ADDITIONAL_RULES, additionalOutcomes, evaluateAdditional } from './additionalBindings';
import { additionalFixtures } from './additionalFixtures';
import { type FeatureCase } from './features';
import { metricResponse, withMetrics } from './metricsFixture';
import { near, number, observation, type Binding, type World } from './shared';

export const SUPPORTED_DETECTORS: ReadonlySet<string> = new Set([
    'DX-001',
    'DX-011',
    'DX-020',
    ...Object.keys(ADDITIONAL_RULES),
]);

function sizing(world: World): ProvisioningEvaluation {
    const result = observation(world);
    assert.ok('band' in result, 'Expected a production sizing evaluation.');
    return result;
}

function errors(world: World): RequestErrorEvaluation {
    const result = observation(world);
    assert.ok('errorRatePercent' in result, 'Expected a production error evaluation.');
    return result;
}

async function evaluate(world: World, detector: string): Promise<void> {
    assert.equal(world.result, undefined, 'A scenario may evaluate only once.');
    const threshold = DEFAULT_ADVISORY_THRESHOLDS.overProvisioningBandPercent;
    if (detector === 'DX-001') {
        assert.ok(world.manual, 'Missing manual offer fixture.');
        world.manual.resourceAgeDays = world.age;
        world.inputs.manualThroughput = [world.manual];
        world.result = overProvisioningDetector.evaluateResult(
            world.manual,
            threshold,
            world.inputs.scopeProvisionedRuTotal,
        );
    } else if (detector === 'DX-011') {
        assert.ok(world.autoscale, 'Missing autoscale fixture.');
        const fixture = world.autoscale;
        const containerId = fixture.shared ? undefined : 'fixture-container';
        const summary = await withMetrics(
            metricResponse(
                'AutoscaledRU',
                fixture.peaks.map((peak) =>
                    Array.from({ length: fixture.samples }, (_, index) =>
                        index === fixture.samples - 1 ? peak : peak / 2,
                    ),
                ),
            ),
            (client) => getAutoscaleUtilization(client, 'fixture-account', 'fixture-db', containerId, fixture.max),
        );
        const input = {
            ...summary,
            databaseId: 'fixture-db',
            containerId,
            configuredMaxRu: fixture.max,
            resourceAgeDays: world.age,
        };
        world.inputs.autoscaleUtilizations = [input];
        world.result = autoscaleMaxOverProvisionedDetector.evaluateResult(input, threshold);
    } else if (detector === 'DX-020') {
        assert.ok(world.statuses, 'Missing status-count fixture.');
        world.inputs.accountRequests = { statusCounts: world.statuses };
        world.result = nonThrottlingErrorsDetector.evaluateResult(world.inputs.accountRequests);
    } else {
        await evaluateAdditional(world, detector);
    }
    assert.ok(world.result, 'The production evaluator must return an observation.');
    world.advisory = world.result.advisory;
    const rule = {
        'DX-001': 'OverProvisioning',
        'DX-011': 'AutoscaleMaxOverProvisioned',
        'DX-020': 'NonThrottlingErrors',
        ...ADDITIONAL_RULES,
    }[detector];
    const registered = computeDerivedAdvisories(world.inputs, DEFAULT_ADVISORY_THRESHOLDS).filter(
        (finding) => finding.rule === rule,
    );
    // Per-rule contracts describe the detector verdict; cross-rule supersession is additional pipeline metadata.
    assert.deepEqual(
        registered.map((finding) => ({ ...finding, supersededBy: undefined })),
        world.advisory ? [{ ...world.advisory, supersededBy: undefined }] : [],
        'Production registry and observed evaluation must agree.',
    );
}

const bindings: readonly Binding[] = [
    ...additionalFixtures,
    ...additionalOutcomes,
    {
        type: 'Action',
        pattern: new RegExp(`^CODA (${Object.keys(ACTION_DETECTORS).join('|')})$`),
        async execute(world, match, detector) {
            assert.equal(ACTION_DETECTORS[match[1]], detector, 'Evaluation step must match its feature detector.');
            await evaluate(world, detector);
        },
    },
    {
        type: 'Context',
        pattern: /^a manual container with (\S+) RU\/s and (\d+) samples at (\S+) percent utilization$/,
        execute(world, match) {
            world.manual = {
                databaseId: 'fixture-db',
                containerId: 'fixture-container',
                provisionedRu: number(match[1]),
                ruPercents: Array<number>(number(match[2])).fill(number(match[3])),
            };
        },
    },
    {
        type: 'Context',
        pattern: /^a manual container with (\S+) RU\/s and no utilization data$/,
        execute(world, match) {
            world.manual = {
                databaseId: 'fixture-db',
                containerId: 'fixture-container',
                provisionedRu: number(match[1]),
                ruPercents: [],
            };
        },
    },
    {
        type: 'Context',
        pattern: /^one more sample at (\S+) percent$/,
        execute(world, match) {
            assert.ok(world.manual);
            world.manual.ruPercents = [...world.manual.ruPercents, number(match[1])];
        },
    },
    {
        type: 'Context',
        pattern: /^the scope provisions (\S+) RU\/s in total$/,
        execute(world, match) {
            world.inputs.scopeProvisionedRuTotal = number(match[1]);
        },
    },
    {
        type: 'Context',
        pattern: /^the container was created (\d+) days before the window ended$/,
        execute(world, match) {
            world.age = number(match[1]);
        },
    },
    {
        type: 'Context',
        pattern:
            /^an autoscale (container|shared database) with a (\d+) RU\/s max whose peak total is (\d+) RU\/s over (\d+) samples$/,
        execute(world, match) {
            world.autoscale = {
                max: number(match[2]),
                peaks: [number(match[3])],
                samples: number(match[4]),
                shared: match[1] === 'shared database',
            };
        },
    },
    {
        type: 'Context',
        pattern:
            /^an autoscale container with a (\d+) RU\/s max whose partitions peak at (\d+) and (\d+) RU\/s over (\d+) samples$/,
        execute(world, match) {
            world.autoscale = {
                max: number(match[1]),
                peaks: [number(match[2]), number(match[3])],
                samples: number(match[4]),
                shared: false,
            };
        },
    },
    {
        type: 'Context',
        pattern: /^an autoscale container with a (\d+) RU\/s max and no autoscale data$/,
        execute(world, match) {
            world.autoscale = { max: number(match[1]), peaks: [], samples: 0, shared: false };
        },
    },
    {
        type: 'Context',
        pattern: /^(\d+) requests of which (\d+) returned status (\S+)$/,
        execute(world, match) {
            world.statuses = { 200: number(match[1]) - number(match[2]), [match[3]]: number(match[2]) };
        },
    },
    {
        type: 'Context',
        pattern: /^(\d+) requests returned status (\S+)$/,
        execute(world, match) {
            assert.ok(world.statuses);
            world.statuses[match[2]] = number(match[1]);
        },
    },
    {
        type: 'Action',
        pattern: /^CODA evaluates (DX-\d{3})$/,
        async execute(world, match, detector) {
            assert.equal(match[1], detector, 'Evaluation step must match its feature detector.');
            await evaluate(world, detector);
        },
    },
    {
        type: 'Outcome',
        pattern: /^the utilization band is (\S+)$/,
        execute(world, match) {
            assert.equal(sizing(world).band, match[1]);
        },
    },
    {
        type: 'Outcome',
        pattern: /^the container is (over-provisioned|not over-provisioned)$/,
        execute(world, match) {
            observation(world);
            assert.equal(world.advisory !== undefined, match[1] === 'over-provisioned');
        },
    },
    {
        type: 'Outcome',
        pattern: /^the recommended (?:throughput|max) is (\S+) RU\/s$/,
        execute(world, match) {
            near(sizing(world).recommendedRu, match[1]);
        },
    },
    {
        type: 'Outcome',
        pattern: /^the wasted capacity is (\S+) RU\/s$/,
        execute(world, match) {
            near(sizing(world).recoverableRu, match[1]);
        },
    },
    {
        type: 'Outcome',
        pattern: /^the severity is (\S+)$/,
        execute(world, match) {
            const result = observation(world);
            const severity = world.advisory?.severity ?? ('severity' in result ? result.severity : undefined) ?? 'None';
            assert.equal(severity.toLowerCase(), match[1].toLowerCase());
        },
    },
    {
        type: 'Outcome',
        pattern: /^the root cause is (\S+)$/,
        execute(world, match) {
            const result = observation(world);
            assert.ok('rootCause' in result);
            assert.equal(result.rootCause, match[1]);
        },
    },
    {
        type: 'Outcome',
        pattern: /^the dominant error code is (\d+)$/,
        execute(world, match) {
            assert.equal(errors(world).dominantStatus, number(match[1]));
        },
    },
    {
        type: 'Outcome',
        pattern: /^the hard error rate is (\S+) percent$/,
        execute(world, match) {
            near(errors(world).errorRatePercent, match[1]);
        },
    },
    {
        type: 'Outcome',
        pattern: /^the DX-020 Agent Kit rule is (\S+)$/,
        execute(world, match) {
            observation(world);
            assert.equal(world.advisory?.agentKitRule ?? null, match[1] === 'null' ? null : match[1]);
        },
    },
    {
        type: 'Outcome',
        pattern: /^the guidance is conditional on request-level investigation$/,
        execute(world) {
            observation(world);
            assert.ok(world.advisory);
            for (const text of [world.advisory.suggestedAction, world.advisory.evidence?.guidance]) {
                assert.equal(typeof text, 'string');
                for (const required of ['status counts alone', 'operation or item', 'read-404-then-insert sequence']) {
                    assert.ok(String(text).includes(required), `Guidance must retain: ${required}`);
                }
            }
        },
    },
];

function resolve(step: PickleStep): Binding {
    if (step.argument) {
        throw new Error('No binding for step tables or doc strings.');
    }
    const matches = bindings.filter(
        (binding) => binding.type === step.type?.toString() && binding.pattern.test(step.text),
    );
    if (matches.length !== 1) {
        throw new Error(`${matches.length === 0 ? 'Unbound' : 'Ambiguous'} ${step.type} step: ${step.text}`);
    }
    return matches[0];
}

export function validateBindings(testCase: FeatureCase): void {
    if (!SUPPORTED_DETECTORS.has(testCase.detector)) {
        throw new Error(`Native CODA bindings are not implemented for ${testCase.detector}.`);
    }
    for (const step of testCase.pickle.steps) {
        resolve(step);
    }
}

export async function executeCase(testCase: FeatureCase): Promise<number> {
    validateBindings(testCase);
    const world: World = {
        inputs: {
            weeklyRuPercents: [],
            hasManualThroughput: false,
            manualThroughput: [],
            partitions: [],
            storage: [],
            indexing: [],
        },
        account: {
            accountName: 'fixture-account',
            api: API.Core,
            regionCount: 1,
            writeRegionCount: 1,
            multiRegionWritesEnabled: false,
            isServerless: false,
            perRegionPerPartitionAutoscaleEnabled: false,
        },
        checks: 0,
    };
    for (const step of testCase.pickle.steps) {
        const binding = resolve(step);
        const match = binding.pattern.exec(step.text);
        assert.ok(match);
        await binding.execute(world, match, testCase.detector);
        if (binding.type === 'Outcome') {
            world.checks++;
        }
    }
    assert.ok(
        (world.result || world.applicabilityChecked) && world.checks > 0,
        'Every scenario must evaluate production code and assert at least one outcome.',
    );
    return world.checks;
}
