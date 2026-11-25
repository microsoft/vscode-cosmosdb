/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Divider,
    Link,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    MessageBarTitle,
    Text,
    useAnnounce,
    useId,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular, DismissRegular, ErrorCircleFilled, NetworkCheckRegular } from '@fluentui/react-icons';
import {
    Container,
    ContainerBody,
    ContainerFooter,
    ContainerHeader,
    ContainerMain,
    ContainerSection,
    StatusList,
    StatusListItem,
} from '@microsoft/vscode-ext-webview-fluentui/components';
import { useTrpcClient } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { useEffect, useRef, useState } from 'react';
import { type CheckResult, type DiagnosticsState, type Step } from '../../../connectionDiagnostics/model';
import {
    checkEvidence,
    checkText,
    phaseLabel,
    statusLabel,
    stepLabel,
} from '../../../connectionDiagnostics/presentation';
import { type ConnectionDiagnosticsRouter } from '../../../panels/ConnectionDiagnosticsTab';
import { useDiagnosticsStyles } from './styles';

const azureSteps: readonly Step[] = ['accountSettings', 'target', 'access', 'dns'];
const savedSteps: readonly Step[] = ['target', 'accountSettings', 'access', 'dns'];

type PanelStyles = ReturnType<typeof useDiagnosticsStyles>;

function rowStatus(check: CheckResult | undefined, active: boolean) {
    if (active) return 'active';
    if (check?.status === 'passed') return 'done';
    if (check?.status === 'failed') return 'error';
    return check?.status === 'info' ? 'warning' : 'pending';
}

function CheckRow({ step, state, styles }: { step: Step; state: DiagnosticsState | undefined; styles: PanelStyles }) {
    const detailsId = useId('diagnostics-details');
    const [expanded, setExpanded] = useState(false);
    const check = state?.checks.find((result) => result.step === step);
    const active = state?.active === step;
    const duration = check?.status !== 'skipped' ? state?.trace?.checkDurations?.[step] : undefined;
    const label = stepLabel(step);
    const evidence = check && checkEvidence(check);
    return (
        <StatusListItem
            className={styles.row}
            aria-current={active ? 'step' : undefined}
            status={rowStatus(check, active)}
            reserveDetailSpace
            label={
                <span className={styles.rowHeading}>
                    <span>{label}</span>
                    {duration !== undefined && (
                        <span className={styles.duration}>
                            {new Intl.NumberFormat(undefined, {
                                style: 'unit',
                                unit: duration < 1000 ? 'millisecond' : 'second',
                                maximumFractionDigits: 2,
                            }).format(duration < 1000 ? duration : duration / 1000)}
                        </span>
                    )}
                </span>
            }
            detail={
                check && state ? (
                    <>
                        <span aria-hidden={check.status !== 'skipped' && evidence === statusLabel(check.status)}>
                            {evidence}
                        </span>{' '}
                        <Link
                            as="button"
                            aria-label={l10n.t('Details for {0}', label)}
                            aria-expanded={expanded}
                            aria-controls={detailsId}
                            onClick={() => setExpanded((value) => !value)}
                        >
                            {l10n.t('Details')}
                        </Link>
                        <span id={detailsId} hidden={!expanded} className={styles.details}>
                            <span>{checkText(check, state.kind)}</span>
                            {check.observedClientIp && (
                                <span>{l10n.t('Outgoing IP reported by Cosmos DB: {0}', check.observedClientIp)}</span>
                            )}
                        </span>
                    </>
                ) : state && state.phase !== 'running' ? (
                    <span aria-hidden>{l10n.t('Not run')}</span>
                ) : undefined
            }
        />
    );
}

function DiagnosticsSummary({ state, styles }: { state: DiagnosticsState; styles: PanelStyles }) {
    const titleId = useId('diagnostics-summary');
    const failure = state.checks.find((check) => check.status === 'failed');
    const keyCheck = state.checks.find(
        (check) => check.finding === 'connected' || check.finding === 'apiProbeUnavailable',
    );
    const cancelled = state.phase === 'cancelled';
    const connected = keyCheck?.finding === 'connected';
    const intent = cancelled ? 'info' : failure ? 'error' : connected ? 'success' : 'info';
    const secondary = state.checks.find(
        (check) =>
            check.finding === 'settingsUnavailable' ||
            check.finding === 'unresolvedDns' ||
            check.finding === 'mixedDns',
    );
    return (
        <section aria-labelledby={titleId}>
            <MessageBar
                intent={intent}
                layout="multiline"
                icon={intent === 'error' ? <ErrorCircleFilled aria-hidden /> : undefined}
            >
                <MessageBarBody className={styles.summary}>
                    <h3 id={titleId} className={styles.summaryTitle}>
                        <MessageBarTitle>{phaseLabel(state)}</MessageBarTitle>
                    </h3>
                    {cancelled ? (
                        <Text>{l10n.t('You cancelled the diagnosis. The results so far are kept.')}</Text>
                    ) : failure ? (
                        <Text>{checkText(failure, state.kind)}</Text>
                    ) : (
                        keyCheck && <Text>{checkText(keyCheck, state.kind)}</Text>
                    )}
                    {!cancelled && !failure && secondary && (
                        <Text>
                            {l10n.t('Also detected:')} {checkText(secondary, state.kind)}
                        </Text>
                    )}
                    {!cancelled && !connected && (
                        <>
                            <Divider />
                            <Text>
                                {l10n.t(
                                    'Contacting support? Use Share report at the bottom of the page to copy or save the report.',
                                )}
                            </Text>
                        </>
                    )}
                </MessageBarBody>
            </MessageBar>
        </section>
    );
}

function checkedText(finishedAt: number, now: number): string {
    const minutes = Math.floor(Math.max(0, now - finishedAt) / 60_000);
    if (minutes === 0) return l10n.t('Checked a few seconds ago');
    if (minutes === 1) return l10n.t('Checked 1 minute ago');
    if (minutes < 60) return l10n.t('Checked {0} minutes ago', minutes);
    return l10n.t('Checked on {0}', new Date(finishedAt).toLocaleString());
}

export function ConnectionDiagnostics() {
    const styles = useDiagnosticsStyles();
    const client = useTrpcClient<ConnectionDiagnosticsRouter>();
    const { announce } = useAnnounce();
    const reportButton = useRef<HTMLButtonElement>(null);
    const outputButton = useRef<HTMLButtonElement>(null);
    const shareButton = useRef<HTMLButtonElement>(null);
    const reportFeedbackReturnFocus = useRef<HTMLButtonElement>(null);
    const [state, setState] = useState<DiagnosticsState>();
    const [revision, setRevision] = useState(0);
    const [failure, setFailure] = useState<string>();
    const [needsRefresh, setNeedsRefresh] = useState(false);
    const [reportFeedback, setReportFeedback] = useState<{ intent: 'success' | 'error'; text: string }>();
    const [pending, setPending] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [now, setNow] = useState(Date.now);

    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        async function readState() {
            try {
                const result = await client.state.query();
                if (stopped) return;
                setState(result);
                if (result.phase === 'running') timer = setTimeout(() => void readState(), 250);
                else setCancelling(false);
            } catch {
                if (!stopped) {
                    setFailure(l10n.t('Could not update connection diagnostics.'));
                    setNeedsRefresh(true);
                    setCancelling(false);
                }
            }
        }
        void readState();
        return () => {
            stopped = true;
            clearTimeout(timer);
        };
    }, [client, revision]);

    const running = state?.phase === 'running';
    const ready = state && state.phase !== 'running';
    const finishedAt = state?.phase === 'completed' ? state.finishedAt : undefined;
    useEffect(() => {
        if (finishedAt === undefined) return;
        setNow(Date.now());
        const interval = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(interval);
    }, [finishedAt]);
    const status = state?.active
        ? l10n.t('Checking: {0}', stepLabel(state.active))
        : state
          ? phaseLabel(state)
          : l10n.t('Loading…');

    useEffect(() => {
        announce(status, { polite: true });
    }, [announce, status]);

    async function runAction() {
        setPending(true);
        setFailure(undefined);
        setReportFeedback(undefined);
        try {
            if (needsRefresh) {
                setNeedsRefresh(false);
                setRevision((value) => value + 1);
            } else if (running) {
                setCancelling(true);
                await client.cancel.mutate();
            } else {
                setState(await client.rerun.mutate());
                setRevision((value) => value + 1);
            }
        } catch {
            setFailure(
                running
                    ? l10n.t('Could not cancel connection diagnostics.')
                    : l10n.t('Could not start connection diagnostics.'),
            );
            setCancelling(false);
        } finally {
            setPending(false);
        }
    }

    async function reportAction(action: 'showReport' | 'copy' | 'save') {
        reportFeedbackReturnFocus.current = (action === 'showReport' ? reportButton : shareButton).current;
        setPending(true);
        setReportFeedback(undefined);
        const error = {
            showReport: l10n.t('Could not show the diagnostics report.'),
            copy: l10n.t('Could not copy the diagnostics report.'),
            save: l10n.t('Could not save the diagnostics report.'),
        }[action];
        try {
            const result = await client[action].mutate();
            if (result === 'failed' || result === 'unavailable') setReportFeedback({ intent: 'error', text: error });
            if (result === 'done' && action !== 'showReport') {
                setReportFeedback({
                    intent: 'success',
                    text:
                        action === 'copy' ? l10n.t('Diagnostics report copied.') : l10n.t('Diagnostics report saved.'),
                });
            }
        } catch {
            setReportFeedback({ intent: 'error', text: error });
        } finally {
            setPending(false);
        }
    }

    async function showOutput() {
        reportFeedbackReturnFocus.current = outputButton.current;
        setPending(true);
        setReportFeedback(undefined);
        try {
            await client.showOutput.mutate();
        } catch {
            setReportFeedback({ intent: 'error', text: l10n.t('Could not open the Azure Cosmos DB Output channel.') });
        } finally {
            setPending(false);
        }
    }

    const steps = state?.kind === 'azure' ? azureSteps : savedSteps;
    const primaryLabel = needsRefresh ? l10n.t('Refresh status') : running ? l10n.t('Cancel') : l10n.t('Re-run');
    const runSubtitle =
        state?.phase === 'running'
            ? l10n.t('Checking the connection…')
            : finishedAt !== undefined
              ? checkedText(finishedAt, now)
              : status;
    return (
        <Container>
            <ContainerBody className={styles.body} contentMaxWidth="760px">
                <ContainerHeader
                    media={<NetworkCheckRegular aria-hidden />}
                    title={l10n.t('Connection Diagnostics')}
                    subtitle={l10n.t('Check a connection step by step and review the results.')}
                />
                <ContainerMain>
                    <ContainerSection
                        title={state?.connectionName ?? l10n.t('Connection checks')}
                        subtitle={runSubtitle}
                    >
                        <StatusList
                            ariaLabel={l10n.t('Connection checks')}
                            statusLabels={{
                                pending: ready ? l10n.t('Not run') : l10n.t('Waiting'),
                                active: l10n.t('Checking'),
                                done: statusLabel('passed'),
                                error: statusLabel('failed'),
                                warning: statusLabel('info'),
                            }}
                        >
                            {steps.map((step) => (
                                <CheckRow key={`${revision}-${step}`} step={step} state={state} styles={styles} />
                            ))}
                        </StatusList>
                        {ready && <DiagnosticsSummary state={state} styles={styles} />}
                        {failure && (
                            <MessageBar intent="error">
                                <MessageBarBody>{failure}</MessageBarBody>
                            </MessageBar>
                        )}
                        {reportFeedback && (
                            <MessageBar intent={reportFeedback.intent}>
                                <MessageBarBody>{reportFeedback.text}</MessageBarBody>
                                <MessageBarActions
                                    containerAction={
                                        <Button
                                            aria-label={l10n.t('Dismiss')}
                                            appearance="transparent"
                                            icon={<DismissRegular aria-hidden />}
                                            onClick={() => {
                                                setReportFeedback(undefined);
                                                reportFeedbackReturnFocus.current?.focus();
                                            }}
                                        />
                                    }
                                />
                            </MessageBar>
                        )}
                    </ContainerSection>
                </ContainerMain>
            </ContainerBody>
            <ContainerFooter
                note={l10n.t('The report omits host and identity details. Review the report before sharing.')}
                contentEnd={
                    <Button ref={outputButton} disabledFocusable={pending} onClick={() => void showOutput()}>
                        {l10n.t('Show Output')}
                    </Button>
                }
            >
                <Button
                    appearance="primary"
                    icon={running && !needsRefresh ? undefined : <ArrowClockwiseRegular aria-hidden />}
                    disabledFocusable={pending || cancelling || (!state && !needsRefresh)}
                    onClick={() => void runAction()}
                >
                    {primaryLabel}
                </Button>
                {ready && (
                    <>
                        <Button
                            ref={reportButton}
                            disabledFocusable={pending}
                            onClick={() => void reportAction('showReport')}
                        >
                            {l10n.t('Show report')}
                        </Button>
                        <Menu>
                            <MenuTrigger disableButtonEnhancement>
                                <Button ref={shareButton} aria-haspopup="menu" disabledFocusable={pending}>
                                    {l10n.t('Share report')}
                                </Button>
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList>
                                    <MenuItem onClick={() => void reportAction('copy')}>
                                        {l10n.t('Copy report to clipboard')}
                                    </MenuItem>
                                    <MenuItem onClick={() => void reportAction('save')}>
                                        {l10n.t('Save report to file…')}
                                    </MenuItem>
                                </MenuList>
                            </MenuPopover>
                        </Menu>
                    </>
                )}
            </ContainerFooter>
        </Container>
    );
}
