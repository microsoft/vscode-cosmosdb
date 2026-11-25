/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    DialogTrigger,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    mergeClasses,
    MessageBar,
    MessageBarBody,
    ProgressBar,
    Textarea,
    useAnnounce,
    useId,
} from '@fluentui/react-components';
import {
    ArrowClockwiseRegular,
    ArrowDownloadRegular,
    CheckmarkCircleFilled,
    ChevronDownRegular,
    ChevronRightRegular,
    CircleRegular,
    DocumentCopyRegular,
    ErrorCircleFilled,
    EyeRegular,
    InfoRegular,
    NetworkCheckRegular,
    OpenRegular,
    ShareRegular,
    StopRegular,
    SubtractCircleRegular,
} from '@fluentui/react-icons';
import { useTrpcClient } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { useEffect, useRef, useState } from 'react';
import { type CheckResult, type DiagnosticsState, type Step } from '../../../connectionDiagnostics/model';
import {
    checkText,
    phaseLabel,
    renderReport,
    statusLabel,
    stepLabel,
} from '../../../connectionDiagnostics/presentation';
import { type ConnectionDiagnosticsRouter } from '../../../panels/ConnectionDiagnosticsTab';
import { useDiagnosticsStyles } from './styles';

const azureSteps: readonly Step[] = ['accountSettings', 'target', 'access', 'dns'];
const savedSteps: readonly Step[] = ['target', 'accountSettings', 'access', 'dns'];

type RowStatus = CheckResult['status'] | 'active' | 'pending' | 'notRun';
type PanelStyles = ReturnType<typeof useDiagnosticsStyles>;

function rowLabel(status: RowStatus): string {
    switch (status) {
        case 'active':
            return l10n.t('Checking');
        case 'pending':
            return l10n.t('Waiting');
        case 'notRun':
            return l10n.t('Not run');
        default:
            return statusLabel(status);
    }
}

function CheckRow({ step, state, styles }: { step: Step; state: DiagnosticsState | undefined; styles: PanelStyles }) {
    const detailsId = useId('diagnostics-details');
    const [expanded, setExpanded] = useState(false);
    const check = state?.checks.find((result) => result.step === step);
    const status: RowStatus =
        check?.status ??
        (state?.active === step ? 'active' : !state || state.phase === 'running' ? 'pending' : 'notRun');
    const StatusIcon = {
        active: NetworkCheckRegular,
        passed: CheckmarkCircleFilled,
        failed: ErrorCircleFilled,
        info: InfoRegular,
        skipped: SubtractCircleRegular,
        notRun: SubtractCircleRegular,
        pending: CircleRegular,
    }[status];
    const label = stepLabel(step);
    const detailsLabel = l10n.t('Details');
    const tone =
        status === 'passed'
            ? styles.success
            : status === 'failed'
              ? styles.error
              : status === 'active' || status === 'info'
                ? styles.info
                : styles.muted;
    return (
        <li
            className={mergeClasses(styles.step, status === 'active' && styles.activeStep)}
            aria-current={status === 'active' ? 'step' : undefined}
        >
            <div className={styles.row}>
                <span className={mergeClasses(styles.rowIcon, tone)}>
                    <StatusIcon aria-hidden />
                </span>
                <span className={styles.rowTitle}>{label}</span>
                <Badge
                    appearance="tint"
                    color={
                        status === 'passed'
                            ? 'success'
                            : status === 'failed'
                              ? 'danger'
                              : status === 'active'
                                ? 'brand'
                                : 'subtle'
                    }
                    shape="rounded"
                >
                    {rowLabel(status)}
                </Badge>
                {check && (
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={expanded ? <ChevronDownRegular aria-hidden /> : <ChevronRightRegular aria-hidden />}
                        aria-label={`${detailsLabel} — ${label}`}
                        aria-expanded={expanded}
                        aria-controls={detailsId}
                        onClick={() => setExpanded((value) => !value)}
                    >
                        {detailsLabel}
                    </Button>
                )}
            </div>
            {check && state && (
                <div className={styles.rowDetails} id={detailsId} hidden={!expanded}>
                    <p>{checkText(check, state.kind)}</p>
                    {check.observedClientIp && (
                        <p>{l10n.t('Outgoing IP reported by Cosmos DB: {0}', check.observedClientIp)}</p>
                    )}
                </div>
            )}
        </li>
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
    const tone = cancelled ? styles.info : failure ? styles.error : connected ? styles.success : styles.info;
    const SummaryIcon = cancelled
        ? InfoRegular
        : failure
          ? ErrorCircleFilled
          : connected
            ? CheckmarkCircleFilled
            : InfoRegular;
    const secondary = state.checks.find(
        (check) =>
            check.finding === 'settingsUnavailable' ||
            check.finding === 'unresolvedDns' ||
            check.finding === 'mixedDns',
    );
    return (
        <section className={mergeClasses(styles.summary, tone)} aria-labelledby={titleId}>
            <span className={styles.summaryIcon}>
                <SummaryIcon aria-hidden />
            </span>
            <div>
                <h2 id={titleId} className={styles.summaryTitle}>
                    {phaseLabel(state)}
                </h2>
                {cancelled ? (
                    <p>
                        {l10n.t(
                            'Completed checks are kept. Run the diagnosis again to finish checking the connection.',
                        )}
                    </p>
                ) : failure ? (
                    <p>{checkText(failure, state.kind)}</p>
                ) : (
                    keyCheck && <p>{checkText(keyCheck, state.kind)}</p>
                )}
                {!cancelled && !failure && secondary && <p>{checkText(secondary, state.kind)}</p>}
            </div>
        </section>
    );
}

export function ConnectionDiagnostics() {
    const styles = useDiagnosticsStyles();
    const client = useTrpcClient<ConnectionDiagnosticsRouter>();
    const { announce } = useAnnounce();
    const checksTitleId = useId('diagnostics-checks');
    const reportButton = useRef<HTMLButtonElement>(null);
    const [state, setState] = useState<DiagnosticsState>();
    const [revision, setRevision] = useState(0);
    const [failure, setFailure] = useState<string>();
    const [needsRefresh, setNeedsRefresh] = useState(false);
    const [reportFeedback, setReportFeedback] = useState<{ intent: 'success' | 'error'; text: string }>();
    const [pending, setPending] = useState(false);
    const [cancelling, setCancelling] = useState(false);

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

    async function share(action: 'copy' | 'save') {
        setPending(true);
        setReportFeedback(undefined);
        const error =
            action === 'copy'
                ? l10n.t('Could not copy the diagnostics report.')
                : l10n.t('Could not save the diagnostics report.');
        try {
            const result = await client[action].mutate();
            if (result === 'failed' || result === 'unavailable') setReportFeedback({ intent: 'error', text: error });
            if (result === 'done') {
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
        setReportFeedback(undefined);
        try {
            await client.showOutput.mutate();
        } catch {
            setReportFeedback({ intent: 'error', text: l10n.t('Could not open the Azure Cosmos DB Output channel.') });
        }
    }

    const steps = state?.kind === 'azure' ? azureSteps : savedSteps;
    const primaryLabel = needsRefresh ? l10n.t('Refresh status') : running ? l10n.t('Cancel') : l10n.t('Run again');
    return (
        <div className={styles.root}>
            <main className={styles.body}>
                <header className={styles.header}>
                    <span className={styles.heroIcon}>
                        <NetworkCheckRegular aria-hidden />
                    </span>
                    <div>
                        <h1 className={styles.title}>{l10n.t('Cosmos DB connection diagnostics')}</h1>
                        <p className={styles.subtitle}>
                            {l10n.t('Check the connection step by step and review the results.')}
                        </p>
                    </div>
                </header>
                <section className={styles.section} aria-labelledby={checksTitleId}>
                    <div>
                        <h2 className={styles.sectionTitle} id={checksTitleId}>
                            {l10n.t('Connection checks')}
                        </h2>
                        {!ready && <p className={styles.subtitle}>{status}</p>}
                    </div>
                    {running && (
                        <ProgressBar
                            className={styles.progress}
                            aria-label={l10n.t('Connection check progress')}
                            value={state.checks.length}
                            max={steps.length}
                        />
                    )}
                    <ol className={styles.checkList} aria-labelledby={checksTitleId}>
                        {steps.map((step) => (
                            <CheckRow key={`${revision}-${step}`} step={step} state={state} styles={styles} />
                        ))}
                    </ol>
                </section>
                {ready && <DiagnosticsSummary state={state} styles={styles} />}
                {failure && (
                    <MessageBar intent="error">
                        <MessageBarBody>{failure}</MessageBarBody>
                    </MessageBar>
                )}
            </main>
            <footer className={styles.footer}>
                <div className={styles.footerContent}>
                    <div className={styles.actions}>
                        <Button
                            appearance="primary"
                            icon={
                                running && !needsRefresh ? (
                                    <StopRegular aria-hidden />
                                ) : (
                                    <ArrowClockwiseRegular aria-hidden />
                                )
                            }
                            disabledFocusable={pending || cancelling || (!state && !needsRefresh)}
                            onClick={() => void runAction()}
                        >
                            {primaryLabel}
                        </Button>
                        <Button icon={<OpenRegular aria-hidden />} onClick={() => void showOutput()}>
                            {l10n.t('Show Output')}
                        </Button>
                        {ready && (
                            <>
                                <Dialog
                                    onOpenChange={(_, { open }) => {
                                        // Return focus after the dialog closes, including when it is dismissed with Escape.
                                        if (!open) requestAnimationFrame(() => reportButton.current?.focus());
                                    }}
                                >
                                    <DialogTrigger disableButtonEnhancement>
                                        <Button
                                            ref={reportButton}
                                            aria-haspopup="dialog"
                                            icon={<EyeRegular aria-hidden />}
                                            disabledFocusable={pending}
                                        >
                                            {l10n.t('Show report')}
                                        </Button>
                                    </DialogTrigger>
                                    <DialogSurface>
                                        <DialogBody>
                                            <DialogTitle>{l10n.t('Redacted diagnostics report')}</DialogTitle>
                                            <DialogContent>
                                                {l10n.t(
                                                    'Review the report before sharing. Account identifiers, endpoints, IP addresses, credentials, and raw errors are omitted.',
                                                )}
                                                <Textarea
                                                    className={styles.report}
                                                    aria-label={l10n.t('Report contents')}
                                                    readOnly
                                                    value={renderReport(state)}
                                                />
                                            </DialogContent>
                                            <DialogActions>
                                                <DialogTrigger disableButtonEnhancement>
                                                    <Button>{l10n.t('Close')}</Button>
                                                </DialogTrigger>
                                            </DialogActions>
                                        </DialogBody>
                                    </DialogSurface>
                                </Dialog>
                                <Menu>
                                    <MenuTrigger disableButtonEnhancement>
                                        <Button
                                            aria-haspopup="menu"
                                            icon={<ShareRegular aria-hidden />}
                                            disabledFocusable={pending}
                                        >
                                            {l10n.t('Share report')}
                                        </Button>
                                    </MenuTrigger>
                                    <MenuPopover>
                                        <MenuList>
                                            <MenuItem
                                                icon={<DocumentCopyRegular aria-hidden />}
                                                onClick={() => void share('copy')}
                                            >
                                                {l10n.t('Copy report to clipboard')}
                                            </MenuItem>
                                            <MenuItem
                                                icon={<ArrowDownloadRegular aria-hidden />}
                                                onClick={() => void share('save')}
                                            >
                                                {l10n.t('Save report to file…')}
                                            </MenuItem>
                                        </MenuList>
                                    </MenuPopover>
                                </Menu>
                            </>
                        )}
                    </div>
                    <p className={styles.footerNote}>{l10n.t('Reports are always redacted.')}</p>
                    {reportFeedback && (
                        <MessageBar className={styles.reportFeedback} intent={reportFeedback.intent}>
                            <MessageBarBody>{reportFeedback.text}</MessageBarBody>
                        </MessageBar>
                    )}
                </div>
            </footer>
        </div>
    );
}
