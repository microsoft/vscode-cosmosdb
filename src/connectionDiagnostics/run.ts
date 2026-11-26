/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DataPlaneProbe } from './dataPlaneProbe';
import { checkDns, shouldCheckDnsAfterAccess } from './dnsProbe';
import { type ActiveStep, type CheckResult, type DiagnosticsState, overviewSteps, type Step } from './model';
import { checkOverviewAccess } from './overviewProbe';
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
    onLocalTrace?: (lines: readonly string[]) => void,
): Promise<void> {
    const emulator = target.kind === 'emulator' || (target.kind === 'queryEditor' && target.connection.isEmulator);
    const azureAccount = getDiagnosticsAzureAccount(target);
    const kind = azureAccount ? 'azure' : emulator ? 'emulator' : target.kind;
    const scope = target.probe === 'query' ? 'container' : undefined;
    const trace = new DiagnosticsRunTrace(kind, target.probe);
    const checks: CheckResult[] = [];
    const progress: { active: ActiveStep } = { active: azureAccount ? 'accountSettings' : 'target' };
    const begin = (step: ActiveStep) => {
        progress.active = step;
        trace.recordChecks(checks);
        for (const started of step === 'accountOverview' ? overviewSteps : [step]) trace.begin(started);
        publish({ kind, scope, phase: 'running', active: step, checks: [...checks], trace: trace.snapshot() });
    };
    try {
        begin(progress.active);
        signal.throwIfAborted();
        await runChecks({ target, signal, emulator, azureAccount, trace, checks, begin, onRbacPrincipal });
        if (target.kind === 'azure') {
            signal.throwIfAborted();
            begin('accountOverview');
            checks.push(...(await checkOverviewAccess(target.account, signal, (step) => trace.endTiming(step))));
        }
    } catch {
        if (!signal.aborted) {
            if (progress.active === 'accountOverview') {
                for (const step of overviewSteps) checks.push({ step, finding: 'overviewUnavailable', status: 'info' });
            } else {
                checks.push({ step: progress.active, finding: 'unexpected', status: 'failed' });
            }
        }
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
        onLocalTrace?.(trace.localSnapshot());
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
    trace.recordEndpoint(url);

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
    checks.push(await checkDns(url, signal, (addresses) => trace.recordDns(url, addresses)));
}
