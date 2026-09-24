/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    makeStyles,
    mergeClasses,
    Spinner,
    useAnnounce,
} from '@fluentui/react-components';
import { Dismiss24Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useEffect, useRef, type ReactNode } from 'react';

export const useThroughputDetailStyles = makeStyles({
    surface: {
        width: 'min(1020px, calc(100vw - 32px))',
        maxWidth: '1020px',
        height: 'min(980px, calc(100vh - 32px))',
        maxHeight: 'calc(100vh - 32px)',
        boxSizing: 'border-box',
        borderRadius: '4px',
        padding: '20px 24px 12px',
        color: 'var(--vscode-editor-foreground)',
        backgroundColor: 'var(--vscode-editor-background)',
        overflowWrap: 'anywhere',
    },
    body: { height: '100%', minHeight: 0, gridTemplateRows: 'auto minmax(0, 1fr) auto' },
    content: { minHeight: 0 },
    subtitle: { margin: '0 0 20px', color: 'var(--vscode-descriptionForeground)', fontSize: '13px' },
    stats: {
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: '16px',
        margin: '0 0 22px',
        '@media (max-width: 650px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
    },
    stat: {
        borderLeft: '4px solid var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground))',
        paddingLeft: '9px',
        '& dt': { fontSize: '11px', textTransform: 'uppercase', color: 'var(--vscode-descriptionForeground)' },
        '& dd': { margin: 0, fontSize: '22px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
    },
    dangerStat: { borderLeftColor: 'var(--vscode-errorForeground)' },
    successStat: { borderLeftColor: 'var(--vscode-charts-green)' },
    section: { borderTop: '1px solid var(--vscode-panel-border)', padding: '16px 0' },
    heading: { fontSize: '14px', fontWeight: 600, margin: '0 0 12px' },
    guidance: {
        display: 'grid',
        gridTemplateColumns: 'minmax(180px, 28%) 1fr',
        gap: '12px 20px',
        margin: 0,
        '& dt': { display: 'flex', gap: '8px', alignItems: 'baseline', fontWeight: 600 },
        '& dd': { margin: 0, color: 'var(--vscode-descriptionForeground)' },
        '@media (max-width: 650px)': { gridTemplateColumns: '1fr' },
    },
    warning: { color: 'var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground))' },
    info: { color: 'var(--vscode-textLink-foreground)', flexShrink: 0 },
    note: { fontSize: '12px', color: 'var(--vscode-descriptionForeground)', lineHeight: '1.5', margin: '8px 0' },
    tableFrame: { overflowX: 'auto' },
    table: {
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '13px',
        '& th': { textAlign: 'left', fontWeight: 600 },
        '& th, & td': { borderBottom: '1px solid var(--vscode-panel-border)', padding: '6px 0' },
        '& th:not(:first-child), & td:not(:first-child)': { textAlign: 'right', paddingLeft: '16px' },
    },
    track: {
        display: 'flex',
        height: '8px',
        backgroundColor: 'var(--vscode-panel-border)',
        border: '1px solid var(--vscode-contrastBorder, transparent)',
        margin: '12px 0',
    },
    legend: { display: 'flex', gap: '20px', flexWrap: 'wrap', fontSize: '12px', margin: '12px 0' },
    footer: { paddingTop: '16px', borderTop: '1px solid var(--vscode-panel-border)' },
});

export function DetailStatistic({
    label,
    value,
    detail,
    tone = 'warning',
}: {
    label: string;
    value: string;
    detail?: string;
    tone?: 'warning' | 'danger' | 'success';
}) {
    const styles = useThroughputDetailStyles();
    return (
        <div
            className={mergeClasses(
                styles.stat,
                tone === 'danger' && styles.dangerStat,
                tone === 'success' && styles.successStat,
            )}
        >
            <dt>{label}</dt>
            <dd aria-description={detail}>{value}</dd>
        </div>
    );
}

export function OverviewThroughputDetailDialog({
    title,
    subtitle,
    busy = false,
    onClose,
    onReviewPartitions,
    children,
}: {
    title: string;
    subtitle: string;
    busy?: boolean;
    onClose: () => void;
    onReviewPartitions: () => void;
    children: ReactNode;
}) {
    const styles = useThroughputDetailStyles();
    const { announce } = useAnnounce();
    const wasBusy = useRef(false);
    useEffect(() => {
        if (busy) {
            announce(l10n.t('Updating throughput details…'), { polite: true });
        } else if (wasBusy.current) {
            announce(l10n.t('Throughput details updated.'), { polite: true });
        }
        wasBusy.current = busy;
    }, [announce, busy]);
    return (
        <Dialog
            open
            onOpenChange={(_, data) => {
                if (!data.open) {
                    onClose();
                }
            }}
        >
            <DialogSurface className={styles.surface}>
                <DialogBody className={styles.body}>
                    <DialogTitle
                        action={
                            <Button
                                appearance="subtle"
                                icon={<Dismiss24Regular aria-hidden />}
                                aria-label={l10n.t('Close')}
                                onClick={onClose}
                            />
                        }
                    >
                        {title}
                    </DialogTitle>
                    <DialogContent className={styles.content} aria-busy={busy}>
                        <p className={styles.subtitle}>{subtitle}</p>
                        {busy && <Spinner size="small" label={l10n.t('Updating throughput details…')} />}
                        {children}
                    </DialogContent>
                    <DialogActions className={styles.footer}>
                        <Button appearance="primary" onClick={onReviewPartitions}>
                            {l10n.t('Review hot partitions')}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
