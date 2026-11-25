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
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { checkHelpTopics, type DiagnosticsHelpTopic, helpLabel } from '../../../connectionDiagnostics/help';
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
type OpenHelp = (topic: DiagnosticsHelpTopic) => void;

function HelpLinks({ topics, openHelp }: { topics: readonly DiagnosticsHelpTopic[]; openHelp: OpenHelp }) {
    return topics.map((topic) => (
        <Link key={topic} as="button" onClick={() => openHelp(topic)}>
            {helpLabel(topic)}
        </Link>
    ));
}

function rowStatus(check: CheckResult | undefined, active: boolean) {
    if (active) return 'active';
    if (check?.status === 'passed') return 'done';
    if (check?.status === 'failed') return 'error';
    return check?.status === 'info' ? 'warning' : 'pending';
}

function CheckRow({
    step,
    state,
    styles,
    openHelp,
}: {
    step: Step;
    state: DiagnosticsState | undefined;
    styles: PanelStyles;
    openHelp: OpenHelp;
}) {
    const detailsId = useId('diagnostics-details');
    const [userExpanded, setUserExpanded] = useState<boolean>();
    const check = state?.checks.find((result) => result.step === step);
    const expanded =
        userExpanded ?? (state?.phase === 'completed' && (check?.status === 'failed' || check?.finding === 'dataRbac'));
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
                            onClick={() => setUserExpanded(!expanded)}
                        >
                            {l10n.t('Details')}
                        </Link>
                        <span id={detailsId} hidden={!expanded} className={styles.details}>
                            <span>{checkText(check, state.kind, { omitRowEvidence: true })}</span>
                            {check.observedClientIp && (
                                <span>{l10n.t('Outgoing IP reported by Cosmos DB: {0}', check.observedClientIp)}</span>
                            )}
                            <HelpLinks topics={checkHelpTopics(check, state.kind)} openHelp={openHelp} />
                        </span>
                    </>
                ) : state && state.phase !== 'running' ? (
                    <span aria-hidden>{l10n.t('Not run')}</span>
                ) : undefined
            }
        />
    );
}

function DiagnosticsSummary({
    state,
    styles,
    roleAction,
    roleFeedback,
}: {
    state: DiagnosticsState;
    styles: PanelStyles;
    roleAction: ReactNode;
    roleFeedback?: string;
}) {
    const titleId = useId('diagnostics-summary');
    const failure = state.checks.find((check) => check.status === 'failed');
    const cancelled = state.phase === 'cancelled';
    const connected = state.checks.some((check) => check.finding === 'connected');
    const needsRole = state.checks.find((check) => check.finding === 'dataRbac');
    const intent = cancelled ? 'info' : needsRole ? 'warning' : failure ? 'error' : connected ? 'success' : 'info';
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
                    {cancelled && <Text>{l10n.t('You cancelled the diagnosis. The results so far are kept.')}</Text>}
                    {!cancelled && needsRole && (
                        <>
                            {!state.canAddDataRole && !roleFeedback && (
                                <Text>
                                    {l10n.t(
                                        'Ask an account administrator to grant the required data-plane permissions.',
                                    )}
                                </Text>
                            )}
                            <output>{roleFeedback}</output>
                        </>
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
                {!cancelled && needsRole && roleAction && <MessageBarActions>{roleAction}</MessageBarActions>}
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
    const primaryButton = useRef<HTMLButtonElement>(null);
    const addRoleButton = useRef<HTMLButtonElement>(null);
    const reportButton = useRef<HTMLButtonElement>(null);
    const outputButton = useRef<HTMLButtonElement>(null);
    const shareButton = useRef<HTMLButtonElement>(null);
    const reportFeedbackReturnFocus = useRef<HTMLButtonElement>(null);
    const [state, setState] = useState<DiagnosticsState>();
    const [revision, setRevision] = useState(0);
    const [failure, setFailure] = useState<string>();
    const [helpFailure, setHelpFailure] = useState<string>();
    const [needsRefresh, setNeedsRefresh] = useState(false);
    const [reportFeedback, setReportFeedback] = useState<{ intent: 'success' | 'error'; text: string }>();
    const [roleFeedback, setRoleFeedback] = useState<string>();
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
        setHelpFailure(undefined);
        setReportFeedback(undefined);
        try {
            if (needsRefresh) {
                setNeedsRefresh(false);
                setRevision((value) => value + 1);
            } else if (running) {
                setCancelling(true);
                await client.cancel.mutate();
            } else {
                setRoleFeedback(undefined);
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

    async function openHelp(topic: DiagnosticsHelpTopic) {
        setHelpFailure(undefined);
        try {
            if (await client.openHelp.mutate(topic)) return;
        } catch {
            // A failed RPC uses the same on-screen message as a browser launch failure.
        }
        setHelpFailure(l10n.t('Could not open the troubleshooting documentation in your browser.'));
    }

    async function addDataRole() {
        const runId = state?.trace?.runId;
        if (!runId || !state?.canAddDataRole) return;
        setPending(true);
        setRoleFeedback(undefined);
        const failed = l10n.t('Could not add the data role. Try again or ask an account administrator.');
        try {
            const outcome = await client.addDataRole.mutate({ runId });
            if (outcome === 'assigned' || outcome === 'unavailable') {
                if (addRoleButton.current?.ownerDocument.activeElement === addRoleButton.current) {
                    primaryButton.current?.focus();
                }
                setState({ ...state, canAddDataRole: false });
            }
            if (outcome === 'assigned') {
                setRoleFeedback(l10n.t('Role assigned. Wait for the permission to take effect, then select Re-run.'));
            } else if (outcome === 'denied') {
                setRoleFeedback(
                    l10n.t('You do not have permission to assign this role. Ask an account administrator.'),
                );
            } else if (outcome === 'failed') {
                setRoleFeedback(failed);
            } else if (outcome === 'unavailable') {
                setRoleFeedback(
                    l10n.t('This result is no longer current. Re-run diagnostics before assigning a role.'),
                );
            }
        } catch {
            setRoleFeedback(failed);
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

    const steps = (state?.kind === 'azure' ? azureSteps : savedSteps).filter(
        (step) => step !== 'dns' || state?.active === step || state?.checks.some((check) => check.step === step),
    );
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
                                <CheckRow
                                    key={`${revision}-${step}`}
                                    step={step}
                                    state={state}
                                    styles={styles}
                                    openHelp={(topic) => void openHelp(topic)}
                                />
                            ))}
                        </StatusList>
                        {ready && (
                            <DiagnosticsSummary
                                state={state}
                                styles={styles}
                                roleFeedback={roleFeedback}
                                roleAction={
                                    state.canAddDataRole && (
                                        <Button
                                            ref={addRoleButton}
                                            disabledFocusable={pending || needsRefresh}
                                            onClick={() => void addDataRole()}
                                        >
                                            {l10n.t('Add Data Contributor role')}
                                        </Button>
                                    )
                                }
                            />
                        )}
                        {failure && (
                            <MessageBar intent="error">
                                <MessageBarBody>{failure}</MessageBarBody>
                            </MessageBar>
                        )}
                        {helpFailure && (
                            <MessageBar intent="error">
                                <MessageBarBody>{helpFailure}</MessageBarBody>
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
                    ref={primaryButton}
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
