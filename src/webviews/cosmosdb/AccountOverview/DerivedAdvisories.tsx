/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, makeStyles, Text, tokens } from '@fluentui/react-components';
import { Dismiss16Regular, Sparkle16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type DerivedAdvisory, type DerivedAdvisorySeverity, type DerivedAdvisoriesResult } from '../../api/types';
import { EmptyState, Pill, type PillTone, useDashboardActions } from './DashboardChrome';

const SEVERITY_TONE: Record<DerivedAdvisorySeverity, PillTone> = {
    High: 'danger',
    Medium: 'warning',
    Low: 'neutral',
};

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
        // Fill the height the card hands down (the card grows to match the main column) and clip, so the list below
        // owns the scroll. When the card is not height-constrained (e.g. the rail wraps under the main column on a
        // narrow viewport), this simply grows to the content height and nothing scrolls.
        flexGrow: 1,
        minHeight: 0,
        overflow: 'hidden',
    },
    provenance: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        alignSelf: 'flex-start',
        flexShrink: 0,
    },
    scrollBody: {
        flexGrow: 1,
        minHeight: 0,
        overflowY: 'auto',
    },
    list: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
    },
    item: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        border: '1px solid var(--vscode-widget-border, var(--vscode-panel-border))',
        backgroundColor: 'var(--vscode-editor-background)',
    },
    titleRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalS,
    },
    titleGroup: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        minWidth: 0,
    },
    title: {
        fontWeight: tokens.fontWeightSemibold,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    rationale: {
        fontSize: tokens.fontSizeBase200,
        color: 'var(--vscode-foreground)',
    },
    action: {
        fontSize: tokens.fontSizeBase200,
        color: 'var(--vscode-descriptionForeground)',
    },
    threshold: {
        fontSize: tokens.fontSizeBase100,
        color: 'var(--vscode-descriptionForeground)',
        fontStyle: 'italic',
    },
    emptyState: {
        padding: tokens.spacingVerticalL,
        textAlign: 'center',
        color: 'var(--vscode-descriptionForeground)',
    },
    srOnly: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
    },
});

function severityLabel(severity: DerivedAdvisorySeverity): string {
    switch (severity) {
        case 'High':
            return l10n.t('High');
        case 'Medium':
            return l10n.t('Medium');
        case 'Low':
            return l10n.t('Low');
    }
}

const AdvisoryRow = ({
    advisory,
    onDismiss,
    buttonRef,
}: {
    advisory: DerivedAdvisory;
    onDismiss: (id: string) => void;
    buttonRef: (el: HTMLButtonElement | null) => void;
}) => {
    const styles = useStyles();
    return (
        <div className={styles.item}>
            <div className={styles.titleRow}>
                <div className={styles.titleGroup}>
                    <Pill tone={SEVERITY_TONE[advisory.severity]}>{severityLabel(advisory.severity)}</Pill>
                    <Text className={styles.title} title={advisory.title}>
                        {advisory.title}
                    </Text>
                </div>
                <Button
                    ref={buttonRef}
                    size="small"
                    appearance="subtle"
                    icon={<Dismiss16Regular />}
                    onClick={() => onDismiss(advisory.id)}
                    aria-label={l10n.t('Dismiss advisory: {title}', { title: advisory.title })}
                />
            </div>
            <Text className={styles.rationale}>{advisory.rationale}</Text>
            <Text className={styles.action}>{advisory.suggestedAction}</Text>
            <Text className={styles.threshold}>{advisory.thresholdReference}</Text>
        </div>
    );
};

export const DerivedAdvisories = ({
    result,
    loading,
    dismissedIds,
    onDismiss,
}: {
    result?: DerivedAdvisoriesResult;
    loading: boolean;
    dismissedIds: ReadonlySet<string>;
    onDismiss: (id: string) => void;
}) => {
    const styles = useStyles();
    const { reportEvent } = useDashboardActions();

    // Focus management for dismissal: keyboard/screen-reader users must not lose their place when a
    // card is removed from the DOM. We capture the focus target (next card, else previous) before the
    // dismiss re-render, then re-apply it once the list settles — falling back to the section container
    // when the last advisory goes away.
    const rootRef = useRef<HTMLDivElement>(null);
    const buttonRefs = useRef(new Map<string, HTMLButtonElement | null>());
    const pendingFocusRef = useRef<{ id: string | null } | null>(null);
    const [announcement, setAnnouncement] = useState('');

    const visible = (result?.advisories ?? []).filter((advisory) => !dismissedIds.has(advisory.id));

    useEffect(() => {
        const pending = pendingFocusRef.current;
        if (!pending) {
            return;
        }
        pendingFocusRef.current = null;
        if (pending.id) {
            buttonRefs.current.get(pending.id)?.focus();
        } else {
            rootRef.current?.focus();
        }
    }, [dismissedIds]);

    const handleDismiss = (id: string) => {
        reportEvent('recommendationClicked', { source: 'derived', action: 'dismiss' });
        const idx = visible.findIndex((advisory) => advisory.id === id);
        const nextFocus = visible[idx + 1] ?? visible[idx - 1];
        pendingFocusRef.current = { id: nextFocus ? nextFocus.id : null };
        const remaining = visible.length - 1;
        setAnnouncement(l10n.t('Advisory dismissed. {count} remaining.', { count: remaining }));
        onDismiss(id);
    };

    const provenance = (
        <Badge className={styles.provenance} appearance="tint" color="informative" icon={<Sparkle16Regular />}>
            {l10n.t('Derived from your telemetry')}
        </Badge>
    );

    let body: ReactNode;
    if (loading && !result) {
        body = <Text className={styles.emptyState}>{l10n.t('Analyzing your telemetry…')}</Text>;
    } else if (!result || !result.available) {
        body = <EmptyState reason={result?.reason ?? 'noData'} requiredRole={l10n.t('Monitoring Reader')} />;
    } else if (visible.length === 0) {
        body = <Text className={styles.emptyState}>{l10n.t('No advisories from your telemetry right now.')}</Text>;
    } else {
        body = (
            <div className={styles.list}>
                {visible.map((advisory) => (
                    <AdvisoryRow
                        key={advisory.id}
                        advisory={advisory}
                        onDismiss={handleDismiss}
                        buttonRef={(el) => {
                            if (el) {
                                buttonRefs.current.set(advisory.id, el);
                            } else {
                                buttonRefs.current.delete(advisory.id);
                            }
                        }}
                    />
                ))}
            </div>
        );
    }

    return (
        <div ref={rootRef} className={styles.root} tabIndex={-1}>
            <output className={styles.srOnly} aria-live="polite">
                {announcement}
            </output>
            {provenance}
            <div className={styles.scrollBody}>{body}</div>
        </div>
    );
};
