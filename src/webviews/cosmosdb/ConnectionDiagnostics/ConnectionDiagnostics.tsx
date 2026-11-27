/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Divider,
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
} from '@fluentui/react-components';
import { ArrowClockwiseRegular, DismissRegular, ErrorCircleFilled, NetworkCheckRegular } from '@fluentui/react-icons';
import {
    Container,
    ContainerBody,
    ContainerFooter,
    ContainerHeader,
    ContainerMain,
    ContainerSection,
} from '@microsoft/vscode-ext-webview-fluentui/components';
import { useTrpcClient } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { useEffect, useRef, useState } from 'react';
import { type DiagnosticsHelpTopic } from '../../../connectionDiagnostics/help';
import {
    type DiagnosticsState,
    getPrimaryDataCheck,
    isOverviewStep,
    overviewSteps,
    type Step,
} from '../../../connectionDiagnostics/model';
import { phaseLabel, stepLabel } from '../../../connectionDiagnostics/presentation';
import { type ConnectionDiagnosticsRouter } from '../../../panels/trpc/routers/connectionDiagnosticsRouter';
import { DiagnosticsCheckRow } from './DiagnosticsCheckRow';
import { useDiagnosticsStyles } from './styles';

const azureSteps: readonly Step[] = ['accountSettings', 'target', 'access', 'dns'];
const savedSteps: readonly Step[] = ['target', 'accountSettings', 'access', 'dns'];

function DiagnosticsSummary({ state }: { state: DiagnosticsState }) {
    const styles = useDiagnosticsStyles();
    const failure = state.checks.find((check) => check.status === 'failed');
    const cancelled = state.phase === 'cancelled';
    const result = getPrimaryDataCheck(state);
    const intent = cancelled
        ? 'info'
        : result?.finding === 'dataRbac'
          ? 'warning'
          : failure
            ? 'error'
            : result?.status === 'passed'
              ? 'success'
              : 'info';
    return (
        <MessageBar
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- MessageBar renders a div.
            role="region"
            intent={intent}
            layout="multiline"
            icon={intent === 'error' ? <ErrorCircleFilled aria-hidden /> : undefined}
        >
            <MessageBarBody className={styles.summary}>
                <h3 className={styles.summaryTitle}>
                    <MessageBarTitle>{phaseLabel(state)}</MessageBarTitle>
                </h3>
                {cancelled && <Text>{l10n.t('You cancelled the diagnosis. The results so far are kept.')}</Text>}
                {!cancelled && result?.status !== 'passed' && (
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
    );
}

function checkedText(finishedAt: number, now: number): string {
    const minutes = Math.floor(Math.max(0, now - finishedAt) / 60_000);
    if (minutes === 0) return l10n.t('Checked a few seconds ago');
    if (minutes === 1) return l10n.t('Checked 1 minute ago');
    if (minutes < 60) return l10n.t('Checked {0} minutes ago', minutes);
    return l10n.t('Checked on {0}', new Date(finishedAt).toLocaleString(document.documentElement.lang || 'en'));
}

function OverviewChecks({
    state,
    helpFailure,
    openHelp,
}: {
    state: DiagnosticsState;
    helpFailure?: Step;
    openHelp: (step: Step, topic: DiagnosticsHelpTopic) => Promise<void>;
}) {
    const styles = useDiagnosticsStyles();
    const checking = state.active === 'accountOverview';
    if (!checking && !state.checks.some(({ step }) => isOverviewStep(step))) return null;
    const title = stepLabel('accountOverview');
    return (
        <ContainerSection
            title={title}
            subtitle={l10n.t('These checks use your Azure sign-in and do not affect the Cosmos DB connection result.')}
        >
            <ul className={styles.checks} aria-label={title} aria-busy={checking}>
                {overviewSteps.map((step) => (
                    <DiagnosticsCheckRow
                        key={step}
                        step={step}
                        state={state}
                        openHelp={(topic) => void openHelp(step, topic)}
                        helpFailed={helpFailure === step}
                    />
                ))}
            </ul>
        </ContainerSection>
    );
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
    const [helpFailure, setHelpFailure] = useState<Step>();
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
    const progress =
        needsRefresh || ready
            ? undefined
            : state?.active
              ? l10n.t('Checking: {0}', stepLabel(state.active))
              : running
                ? l10n.t('Checking the connection…')
                : l10n.t('Loading…');

    useEffect(() => {
        // MessageBar announces the final outcome; announce only progress here.
        if (progress) announce(progress, { polite: true, batchId: 'diagnostics-progress' });
    }, [announce, progress]);

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

    async function openHelp(step: Step, topic: DiagnosticsHelpTopic) {
        setHelpFailure(undefined);
        try {
            if (await client.openHelp.mutate(topic)) return;
        } catch {
            // A failed RPC uses the same on-screen message as a browser launch failure.
        }
        setHelpFailure(step);
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

    const baseSteps = state?.kind === 'azure' ? azureSteps : savedSteps;
    const plannedSteps =
        state?.scope === 'container'
            ? baseSteps.flatMap((step): Step[] => (step === 'dns' ? ['query', 'dns'] : [step]))
            : baseSteps;
    const steps = plannedSteps.filter(
        (step) => step !== 'dns' || state?.active === step || state?.checks.some((check) => check.step === step),
    );
    const primaryLabel = needsRefresh ? l10n.t('Refresh status') : running ? l10n.t('Cancel') : l10n.t('Re-run');
    const runSubtitle =
        running && !needsRefresh
            ? l10n.t('Checking the connection…')
            : finishedAt !== undefined
              ? checkedText(finishedAt, now)
              : progress;
    const title = l10n.t('Connection Diagnostics');
    return (
        <Container>
            <ContainerBody
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Name the shared component's focusable div.
                role="region"
                aria-label={title}
                className={styles.body}
                contentMaxWidth="760px"
            >
                <ContainerHeader
                    media={<NetworkCheckRegular aria-hidden />}
                    title={title}
                    subtitle={l10n.t('Check a connection step by step and review the results.')}
                />
                <ContainerMain>
                    <ContainerSection
                        title={state?.connectionName ?? l10n.t('Connection checks')}
                        subtitle={runSubtitle}
                    >
                        <ul className={styles.checks} aria-label={l10n.t('Connection checks')}>
                            {steps.map((step) => (
                                <DiagnosticsCheckRow
                                    key={step}
                                    step={step}
                                    state={state}
                                    openHelp={(topic) => void openHelp(step, topic)}
                                    helpFailed={helpFailure === step}
                                    roleFeedback={step === 'access' ? roleFeedback : undefined}
                                    roleAction={
                                        step === 'access' &&
                                        state?.phase === 'completed' &&
                                        state.canAddDataRole && (
                                            <Button
                                                ref={addRoleButton}
                                                size="small"
                                                appearance="primary"
                                                disabledFocusable={pending || needsRefresh}
                                                onClick={() => void addDataRole()}
                                            >
                                                {l10n.t('Add Data Contributor role')}
                                            </Button>
                                        )
                                    }
                                />
                            ))}
                        </ul>
                        {ready && <DiagnosticsSummary key={state.trace?.runId} state={state} />}
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
                    {state && <OverviewChecks state={state} helpFailure={helpFailure} openHelp={openHelp} />}
                </ContainerMain>
            </ContainerBody>
            <ContainerFooter
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Group non-form report and diagnostics actions.
                role="group"
                aria-label={l10n.t('Diagnostics actions')}
                note={l10n.t(
                    'Show report includes local network details. Use Share report to copy or save a redacted report.',
                )}
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
