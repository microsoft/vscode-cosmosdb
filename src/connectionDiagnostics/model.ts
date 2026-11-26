/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type TargetKind = 'azure' | 'attached' | 'emulator' | 'queryEditor';
export const overviewSteps = ['metrics', 'alerts', 'advisor', 'requestLogs', 'queryLogs'] as const;
export type OverviewStep = (typeof overviewSteps)[number];
export type Step = 'target' | 'accountSettings' | 'access' | 'query' | 'dns' | OverviewStep;
export type ActiveStep = Step | 'accountOverview';

export function isOverviewStep(step: Step): step is OverviewStep {
    return overviewSteps.some((overviewStep) => overviewStep === step);
}
export type ProbeKind = 'nosql' | 'network' | 'query';
export type FailureStage = 'credentials' | 'accountMetadata' | 'listDatabases' | 'containerMetadata' | 'query';
export type Finding =
    | 'endpointReady'
    | 'invalidEndpoint'
    | 'settingsRead'
    | 'settingsUnavailable'
    | 'settingsNotApplicable'
    | 'apiProbeUnavailable'
    | 'connected'
    | 'querySucceeded'
    | 'queryNotRun'
    | 'missingCredentials'
    | 'authentication'
    | 'tokenUnavailable'
    | 'localAuthDisabled'
    | 'dataRbac'
    | 'dataPlaneOperationDenied'
    | 'firewallPublic'
    | 'firewallServiceEndpoint'
    | 'firewallPrivateEndpoint'
    | 'firewallUnknown'
    | 'forbiddenUnknown'
    | 'proxyAuthentication'
    | 'dnsFailure'
    | 'tlsFailure'
    | 'transportFailure'
    | 'connectionRefused'
    | 'connectionReset'
    | 'connectionTimedOut'
    | 'requestTimedOut'
    | 'containerUnavailable'
    | 'throttled'
    | 'serviceUnavailable'
    | 'unexpected'
    | 'timedOut'
    | 'privateDns'
    | 'publicDns'
    | 'mixedDns'
    | 'unresolvedDns'
    | 'overviewRead'
    | 'overviewDenied'
    | 'overviewAuthentication'
    | 'overviewLogsMissing'
    | 'overviewUnavailable'
    | 'overviewTimedOut';

export interface NetworkSummary {
    publicAccess: 'enabled' | 'disabled' | 'securedByPerimeter' | 'unknown';
    ipRules: number;
    vnetFilterEnabled: boolean;
    vnetRules: number;
    privateEndpoints: number;
    localAuthDisabled: boolean;
}

export interface CheckResult {
    step: Step;
    finding: Finding;
    status: 'passed' | 'failed' | 'info' | 'skipped';
    network?: NetworkSummary;
    auth?: 'key' | 'entra' | 'identity';
    failureStage?: FailureStage;
    http?: { status: number; substatus?: number };
    /** Local display only; never included in copied reports. */
    observedClientIp?: string;
}

export interface DiagnosticsState {
    kind: TargetKind;
    scope?: 'container';
    /** Local panel heading only. */
    connectionName?: string;
    /** Local action availability only. Identity details stay on the host. */
    canAddDataRole?: boolean;
    phase: 'running' | 'completed' | 'cancelled';
    finishedAt?: number;
    active?: ActiveStep;
    checks: CheckResult[];
    /** Shareable trace only. Actual endpoints are kept in the local Output channel. */
    trace?: { runId: string; lines: readonly string[]; checkDurations?: Partial<Record<Step, number>> };
}

export function getPrimaryDataCheck(state: DiagnosticsState): CheckResult | undefined {
    return (
        state.checks.find(({ step, status }) => step === 'query' && status !== 'skipped') ??
        state.checks.find(({ step }) => step === 'access')
    );
}
