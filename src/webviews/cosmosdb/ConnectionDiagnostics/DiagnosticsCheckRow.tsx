/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Spinner, Text, useId } from '@fluentui/react-components';
import {
    CheckmarkCircleFilled,
    CircleHintFilled,
    ErrorCircleFilled,
    OpenRegular,
    WarningRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ReactNode } from 'react';
import { checkHelpTopics, type DiagnosticsHelpTopic, helpLabel } from '../../../connectionDiagnostics/help';
import {
    type CheckResult,
    type DiagnosticsState,
    isOverviewStep,
    type Step,
} from '../../../connectionDiagnostics/model';
import { checkEvidence, checkText, statusLabel, stepLabel } from '../../../connectionDiagnostics/presentation';
import { useDiagnosticsStyles } from './styles';

type CheckRowProps = {
    step: Step;
    state: DiagnosticsState | undefined;
    openHelp: (topic: DiagnosticsHelpTopic) => void;
    helpFailed: boolean;
    roleAction?: ReactNode;
    roleFeedback?: string;
};

function CheckStatus({ status }: { status: CheckResult['status'] | 'checking' | 'waiting' | 'notRun' }) {
    const styles = useDiagnosticsStyles();
    const label =
        status === 'checking'
            ? l10n.t('Checking')
            : status === 'waiting'
              ? l10n.t('Waiting')
              : status === 'notRun'
                ? undefined // The row already shows "Not run" as text.
                : statusLabel(status);
    const icon = {
        passed: <CheckmarkCircleFilled aria-hidden className={styles.passed} />,
        failed: <ErrorCircleFilled aria-hidden className={styles.failed} />,
        info: <WarningRegular aria-hidden className={styles.info} />,
        checking: <Spinner size="extra-tiny" aria-hidden />,
        pending: <CircleHintFilled aria-hidden className={styles.pending} />,
    }[status === 'notRun' || status === 'waiting' || status === 'skipped' ? 'pending' : status];
    return (
        <span className={styles.icon} role={label ? 'img' : undefined} aria-label={label}>
            {icon}
        </span>
    );
}

function CheckDetails({
    check,
    state,
    labelId,
    openHelp,
    helpFailed,
    roleAction,
    roleFeedback,
}: Omit<CheckRowProps, 'step' | 'state'> & { check: CheckResult; state: DiagnosticsState; labelId: string }) {
    const styles = useDiagnosticsStyles();
    const evidence = checkEvidence(check);
    const topics = checkHelpTopics(check, state.kind);
    const needsRole = state.phase === 'completed' && check.finding === 'dataRbac';
    const remediation = needsRole ? roleAction : undefined;
    return (
        <>
            {evidence && <span>{evidence}</span>}
            <span>{checkText(check, state.kind, { omitRowEvidence: true })}</span>
            {check.observedClientIp && (
                <span>{l10n.t('Outgoing IP reported by Cosmos DB: {0}', check.observedClientIp)}</span>
            )}
            {needsRole && !state.canAddDataRole && !roleFeedback && (
                <span>{l10n.t('Ask an account administrator to grant the required data-plane permissions.')}</span>
            )}
            {(remediation || topics.length > 0) && (
                <div
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Group non-form documentation and remediation actions.
                    role="group"
                    className={styles.actions}
                    aria-labelledby={labelId}
                >
                    {remediation}
                    {topics.map((topic) => (
                        <Button
                            key={topic}
                            size="small"
                            icon={<OpenRegular aria-hidden />}
                            onClick={() => openHelp(topic)}
                        >
                            {helpLabel(topic)}
                        </Button>
                    ))}
                </div>
            )}
            {needsRole && <output>{roleFeedback}</output>}
            {helpFailed && (
                <span role="alert" className={styles.actionError}>
                    {l10n.t('Could not open the troubleshooting documentation in your browser.')}
                </span>
            )}
        </>
    );
}

export function DiagnosticsCheckRow({ step, state, ...details }: CheckRowProps) {
    const styles = useDiagnosticsStyles();
    const labelId = useId('diagnostics-check');
    const check = state?.checks.find((result) => result.step === step);
    const active = state?.phase === 'running' && state.active === step;
    const checking = active || (state?.active === 'accountOverview' && isOverviewStep(step));
    const notRun = !check && state && state.phase !== 'running';
    const duration = check?.status !== 'skipped' ? state?.trace?.checkDurations?.[step] : undefined;
    return (
        <li className={styles.row} aria-current={active ? 'step' : undefined}>
            <Text className={styles.rowHeading}>
                <span id={labelId}>{stepLabel(step)}</span>
                {duration !== undefined && (
                    <span className={styles.duration}>
                        {new Intl.NumberFormat(document.documentElement.lang || 'en', {
                            style: 'unit',
                            unit: duration < 1000 ? 'millisecond' : 'second',
                            maximumFractionDigits: 2,
                        }).format(duration < 1000 ? duration : duration / 1000)}
                    </span>
                )}
            </Text>
            <CheckStatus status={checking ? 'checking' : (check?.status ?? (notRun ? 'notRun' : 'waiting'))} />
            <div className={styles.details}>
                {check && state ? (
                    <CheckDetails {...details} check={check} state={state} labelId={labelId} />
                ) : (
                    notRun && <span>{l10n.t('Not run')}</span>
                )}
            </div>
        </li>
    );
}
