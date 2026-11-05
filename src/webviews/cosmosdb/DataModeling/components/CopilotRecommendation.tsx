/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Spinner, Text, tokens } from '@fluentui/react-components';
import { SparkleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useEffect, useRef, useState } from 'react';

/** Lifecycle of the Copilot partition-key recommendation request. */
export type RecommendationStatus = 'idle' | 'waiting' | 'stopped' | 'received' | 'error';

const useStyles = makeStyles({
    panel: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
        padding: tokens.spacingHorizontalL,
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorBrandStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    header: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) repeat(2, minmax(0, 160px))',
        alignItems: 'start',
        gap: tokens.spacingHorizontalM,
    },
    heading: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        minHeight: '32px',
    },
    action: {
        gridColumn: '3',
        width: '100%',
    },
    headerIcon: {
        color: tokens.colorBrandForeground1,
        fontSize: tokens.fontSizeBase500,
    },
    title: {
        fontWeight: tokens.fontWeightSemibold,
    },
    row: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: tokens.spacingHorizontalM,
    },
    error: {
        color: tokens.colorPaletteRedForeground1,
    },
});

export interface CopilotRecommendationStatusProps {
    status: RecommendationStatus;
    error?: string;
    onRetry: () => void;
    onEditModel: () => void;
    onStopWaiting: () => Promise<void>;
}

/**
 * Status panel for the Copilot recommendation request. Renders the idle prompt, the in-flight
 * waiting note with local-stop recovery, or a stopped/error state with retry and model-editing actions.
 * The `received` payload is rendered by the Result page itself, so this component shows nothing in that state.
 */
export function CopilotRecommendation({
    status,
    error,
    onRetry,
    onEditModel,
    onStopWaiting,
}: CopilotRecommendationStatusProps) {
    const styles = useStyles();
    const actionRef = useRef<HTMLButtonElement>(null);
    const previousStatus = useRef(status);
    const wasStopping = useRef(false);
    const stopPending = useRef(false);
    const [stopping, setStopping] = useState(false);
    const [stopError, setStopError] = useState('');
    useEffect(() => {
        if (
            status === 'stopped' ||
            (previousStatus.current === 'stopped' && status === 'waiting') ||
            (wasStopping.current && !stopping)
        ) {
            actionRef.current?.focus();
        }
        previousStatus.current = status;
        wasStopping.current = stopping;
    }, [status, stopping]);

    const stopWaiting = async () => {
        if (stopPending.current) return;
        stopPending.current = true;
        setStopping(true);
        setStopError('');
        try {
            await onStopWaiting();
        } catch {
            setStopError(l10n.t('Could not stop waiting for the recommendation. Please try again.'));
        } finally {
            stopPending.current = false;
            setStopping(false);
        }
    };

    if (status === 'received') {
        return null;
    }

    const actionLabel = {
        idle: l10n.t('Get Recommendation'),
        waiting: l10n.t('Stop waiting'),
        stopped: l10n.t('Retry'),
        error: l10n.t('Retry'),
    }[status];

    return (
        <section className={styles.panel} aria-live="polite">
            <div className={styles.header}>
                <div className={styles.heading}>
                    <SparkleRegular className={styles.headerIcon} aria-hidden="true" />
                    <Text className={styles.title}>{l10n.t("Copilot's recommendation")}</Text>
                </div>
                {status === 'stopped' || status === 'error' ? (
                    <Button appearance={status === 'error' ? 'primary' : 'secondary'} onClick={onEditModel}>
                        {l10n.t('Edit model')}
                    </Button>
                ) : null}
                <Button
                    ref={actionRef}
                    className={styles.action}
                    appearance={status === 'idle' || status === 'stopped' ? 'primary' : 'secondary'}
                    disabled={status === 'waiting' && stopping}
                    aria-description={
                        status === 'waiting'
                            ? l10n.t('This only resets local tracking; it does not stop the agent in Chat.')
                            : undefined
                    }
                    onClick={() => {
                        if (status === 'waiting') {
                            void stopWaiting();
                        } else {
                            setStopError('');
                            onRetry();
                        }
                    }}
                >
                    {actionLabel}
                </Button>
            </div>

            {status === 'idle' ? (
                <div className={styles.row}>
                    <Text>{l10n.t('Ask Copilot to recommend the best partition key for this model.')}</Text>
                </div>
            ) : null}

            {status === 'waiting' ? (
                <div className={styles.row}>
                    <Spinner size="tiny" aria-hidden="true" />
                    <Text>
                        {l10n.t(
                            'Waiting for Copilot… The recommendation will appear here after Copilot analyzes your data model.',
                        )}
                    </Text>
                    {stopError ? <Text className={styles.error}>{stopError}</Text> : null}
                </div>
            ) : null}

            {status === 'stopped' ? (
                <div className={styles.row}>
                    <Text>
                        {l10n.t('Stopped waiting for Copilot. Chat was not cancelled. You can retry when ready.')}
                    </Text>
                </div>
            ) : null}

            {status === 'error' ? (
                <div className={styles.row}>
                    <Text className={styles.error}>
                        {error ?? l10n.t('Copilot could not produce a recommendation.')}
                    </Text>
                </div>
            ) : null}
        </section>
    );
}
