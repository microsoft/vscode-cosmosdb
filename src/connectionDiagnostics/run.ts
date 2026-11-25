/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DataPlaneProbe } from './dataPlaneProbe';
import { checkDns, shouldCheckDnsAfterAccess } from './dnsProbe';
import { type CheckResult, type DiagnosticsState, type Step } from './model';
import { DiagnosticsRunTrace, reportDiagnosticsOutcome } from './runTrace';
import {
    checkAccountSettings,
    type DiagnosticsArmAccount,
    type DiagnosticsAzureAccount,
    type DiagnosticsTarget,
    getConnectionDetails,
    getDiagnosticsAzureAccount,
    validEndpoint,
} from './target';

export async function runDiagnostics(
    target: DiagnosticsTarget,
    signal: AbortSignal,
    publish: (state: DiagnosticsState) => void,
    onRbacPrincipal?: (principalId: string, account: DiagnosticsAzureAccount) => void,
): Promise<void> {
    const emulator = target.kind === 'emulator' || (target.kind === 'queryEditor' && target.connection.isEmulator);
    const azureAccount = getDiagnosticsAzureAccount(target);
    const kind = azureAccount ? 'azure' : emulator ? 'emulator' : target.kind;
    const scope = target.probe === 'query' ? 'container' : undefined;
    const trace = new DiagnosticsRunTrace(kind, target.probe);
    const checks: CheckResult[] = [];
    let active: Step = azureAccount ? 'accountSettings' : 'target';
    const begin = (step: Step) => {
        active = step;
        trace.recordChecks(checks);
        trace.begin(step);
        publish({ kind, scope, phase: 'running', active, checks: [...checks], trace: trace.snapshot() });
    };
    try {
        begin(active);
        signal.throwIfAborted();
        await runChecks({ target, signal, emulator, azureAccount, trace, checks, begin, onRbacPrincipal });
    } catch {
        if (!signal.aborted) checks.push({ step: active, finding: 'unexpected', status: 'failed' });
    } finally {
        trace.recordChecks(checks);
        const phase = signal.aborted ? 'cancelled' : 'completed';
        const durationMs = trace.complete(phase);
        const state: DiagnosticsState = {
            kind,
            scope,
            phase,
            finishedAt: Date.now(),
            checks: [...checks],
            trace: trace.snapshot(),
        };
        publish(state);
        await reportDiagnosticsOutcome(state, target.probe, durationMs);
    }
}

type RunChecksOptions = {
    target: DiagnosticsTarget;
    signal: AbortSignal;
    emulator: boolean;
    azureAccount?: DiagnosticsAzureAccount;
    trace: DiagnosticsRunTrace;
    checks: CheckResult[];
    begin: (step: Step) => void;
    onRbacPrincipal?: (principalId: string, account: DiagnosticsAzureAccount) => void;
};

async function runChecks(options: RunChecksOptions): Promise<void> {
    const { target, signal, emulator, azureAccount, trace, checks, begin, onRbacPrincipal } = options;
    const { endpoint, key, tenantId } = getConnectionDetails(target);
    let arm: DiagnosticsArmAccount | undefined;
    if (azureAccount) {
        const settings = await checkAccountSettings(azureAccount, signal);
        arm = settings.arm;
        checks.push(settings.result);
        begin('target');
    } else {
        checks.push({ step: 'accountSettings', finding: 'settingsNotApplicable', status: 'skipped' });
    }

    const configuredEndpoint = target.kind === 'azure' ? (arm?.databaseAccount.documentEndpoint ?? endpoint) : endpoint;
    const url = validEndpoint(configuredEndpoint, emulator);
    checks.unshift({
        step: 'target',
        finding: url ? 'endpointReady' : 'invalidEndpoint',
        status: url ? 'passed' : 'failed',
    });
    if (target.probe === 'network') checks.push({ step: 'access', finding: 'apiProbeUnavailable', status: 'skipped' });
    if (!url) return;

    if (target.probe !== 'network') {
        begin('access');
        await new DataPlaneProbe({
            target,
            url,
            emulator,
            key,
            tenantId,
            arm,
            azureAccount,
            signal,
            trace,
            onRbacPrincipal,
            record: (result) => checks.push(result),
            beginQuery: () => begin('query'),
        }).run();
        if (target.probe === 'query' && !checks.some(({ step }) => step === 'query')) {
            checks.push({ step: 'query', finding: 'queryNotRun', status: 'skipped' });
        }
        if (!shouldCheckDnsAfterAccess(checks)) return;
    }

    begin('dns');
    checks.push(await checkDns(url, signal));
}
