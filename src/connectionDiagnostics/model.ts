/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type TargetKind = 'azure' | 'attached' | 'emulator';
export type Step = 'target' | 'accountSettings' | 'access' | 'dns';
export type Finding =
    | 'endpointReady'
    | 'invalidEndpoint'
    | 'settingsRead'
    | 'settingsUnavailable'
    | 'settingsNotApplicable'
    | 'apiProbeUnavailable'
    | 'connected'
    | 'missingCredentials'
    | 'authentication'
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
    | 'throttled'
    | 'serviceUnavailable'
    | 'unexpected'
    | 'timedOut'
    | 'privateDns'
    | 'publicDns'
    | 'mixedDns'
    | 'unresolvedDns';

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
    /** Local display only; never included in copied reports. */
    observedClientIp?: string;
}

export interface DiagnosticsState {
    kind: TargetKind;
    /** Local panel heading only. */
    connectionName?: string;
    /** Local action availability only. Identity details stay on the host. */
    canAddDataRole?: boolean;
    phase: 'running' | 'completed' | 'cancelled';
    finishedAt?: number;
    active?: Step;
    checks: CheckResult[];
    /** Shareable trace only. Actual endpoints are kept in the local Output channel. */
    trace?: { runId: string; lines: readonly string[]; checkDurations?: Partial<Record<Step, number>> };
}
