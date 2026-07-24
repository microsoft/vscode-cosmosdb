/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, Text, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type MetricSeriesResult, type UnavailableReason } from '../../../api/types';
import { formatMetricValue, METRIC_GROUPS, type MetricViewDescriptor, tileScalar } from './descriptors';

// ─── Metric tile ────────────────────────────────────────────────────────────────
//
// A selectable scalar tile for one metric. Clicking it selects the metric whose
// chart is expanded inline below the tile row (see `MetricsSection`). The scalar is
// derived from the series via the descriptor's tile-pick; an unavailable series
// renders a muted em dash rather than an error.

/** Distinct, localized caption for an unavailable tile so RBAC/unsupported don't look like empty telemetry. */
function unavailableCaption(reason: UnavailableReason | undefined): string {
    switch (reason) {
        case 'rbac':
            return l10n.t('No permission');
        case 'unsupported':
            return l10n.t('Not supported');
        case 'logAnalyticsDisabled':
            return l10n.t('Logs not enabled');
        case 'noData':
        default:
            return l10n.t('No data');
    }
}

const useStyles = makeStyles({
    tile: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: tokens.spacingVerticalM,
        borderRadius: tokens.borderRadiusMedium,
        border: '1px solid var(--vscode-widget-border, transparent)',
        borderLeftWidth: '3px',
        backgroundColor: 'var(--vscode-editorWidget-background, var(--vscode-editor-background))',
        cursor: 'pointer',
        textAlign: 'left',
        color: 'var(--vscode-foreground)',
        minWidth: 0,
    },
    tileSelected: {
        borderTopColor: 'var(--vscode-focusBorder)',
        borderRightColor: 'var(--vscode-focusBorder)',
        borderBottomColor: 'var(--vscode-focusBorder)',
        boxShadow: '0 0 0 1px var(--vscode-focusBorder)',
    },
    label: {
        fontSize: tokens.fontSizeBase200,
        color: 'var(--vscode-descriptionForeground)',
    },
    value: {
        fontSize: tokens.fontSizeBase500,
        fontWeight: tokens.fontWeightSemibold,
    },
    caption: {
        fontSize: tokens.fontSizeBase100,
        color: 'var(--vscode-descriptionForeground)',
    },
    visuallyHidden: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0 0 0 0)',
        whiteSpace: 'nowrap',
        border: 0,
    },
});

export const MetricTile = ({
    descriptor,
    series,
    loading,
    selected,
    onSelect,
}: {
    descriptor: MetricViewDescriptor;
    series?: MetricSeriesResult;
    loading: boolean;
    selected: boolean;
    onSelect: () => void;
}) => {
    const styles = useStyles();
    const group = METRIC_GROUPS[descriptor.group];

    const scalar = series?.available ? tileScalar(descriptor, series.points, series.peak) : undefined;
    const value = series?.available ? formatMetricValue(descriptor.unit, scalar) : '—';
    const caption =
        loading && !series
            ? l10n.t('Loading…')
            : series?.available
              ? descriptor.seriesLabel
              : unavailableCaption(series?.reason);

    return (
        <button
            type="button"
            className={mergeClasses(styles.tile, selected && styles.tileSelected)}
            style={{ borderLeftColor: group.color }}
            aria-pressed={selected}
            onClick={onSelect}
        >
            <Text className={styles.label}>{descriptor.label}</Text>
            <Text className={styles.value}>{value}</Text>
            <Text className={styles.caption}>{caption}</Text>
            <Text className={styles.visuallyHidden}>{group.label}</Text>
        </button>
    );
};
