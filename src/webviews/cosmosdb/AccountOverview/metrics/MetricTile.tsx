/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    buttonClassNames,
    makeStyles,
    mergeClasses,
    Text,
    textClassNames,
    tokens,
    typographyStyles,
} from '@fluentui/react-components';
import { Eye16Regular } from '@fluentui/react-icons';
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
        ...typographyStyles.body1,
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
        padding: tokens.spacingVerticalM,
        borderRadius: tokens.borderRadiusMedium,
        border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStrokeAccessible}`,
        borderLeftWidth: tokens.strokeWidthThicker,
        backgroundColor: tokens.colorNeutralBackground1,
        cursor: 'pointer',
        textAlign: 'left',
        color: tokens.colorNeutralForeground1,
        minWidth: 0,
        ':focus-visible': {
            outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: tokens.strokeWidthThicker,
        },
    },
    interactiveCard: {
        position: 'relative',
        display: 'flex',
        minWidth: 0,
        borderRadius: tokens.borderRadiusMedium,
        border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStrokeAccessible}`,
        borderLeft: `${tokens.strokeWidthThicker} solid transparent`,
        backgroundColor: tokens.colorNeutralBackground1,
        ':hover': {
            backgroundColor: tokens.colorNeutralBackground1Hover,
        },
    },
    interactiveUnselected: {
        ':hover': {
            borderTopColor: tokens.colorNeutralStrokeAccessibleHover,
            borderRightColor: tokens.colorNeutralStrokeAccessibleHover,
            borderBottomColor: tokens.colorNeutralStrokeAccessibleHover,
            // High-contrast hover backgrounds require the matching foreground for both text and the eye action.
            [`& .${textClassNames.root}, & .${buttonClassNames.root}`]: {
                color: tokens.colorNeutralForeground1Hover,
            },
        },
    },
    cardButton: {
        flexGrow: 1,
        border: 0,
        backgroundColor: 'transparent',
        paddingBottom: '40px',
    },
    eye: {
        position: 'absolute',
        bottom: tokens.spacingVerticalXS,
        right: tokens.spacingHorizontalXS,
    },
    label: {
        ...typographyStyles.body1,
        color: tokens.colorNeutralForeground2,
    },
    value: {
        ...typographyStyles.subtitle1,
    },
    caption: {
        ...typographyStyles.caption1,
        color: tokens.colorNeutralForeground2,
    },
    visuallyHidden: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clipPath: 'inset(50%)',
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
    chartAffordances = false,
    groupLabelId,
}: {
    descriptor: MetricViewDescriptor;
    series?: MetricSeriesResult;
    loading: boolean;
    selected: boolean;
    onSelect: () => void;
    chartAffordances?: boolean;
    groupLabelId?: string;
}) => {
    const styles = useStyles();
    const group = METRIC_GROUPS[descriptor.group];
    const selectedStyle = selected
        ? {
              backgroundColor: group.background,
              borderTopColor: group.border,
              borderRightColor: group.border,
              borderBottomColor: group.border,
          }
        : undefined;
    const selectedTextStyle = selected ? { color: group.color } : undefined;

    const scalar = series?.available ? tileScalar(descriptor, series.points, series.peak) : undefined;
    const value = series?.available ? formatMetricValue(descriptor.unit, scalar) : '—';
    const caption =
        loading && !series
            ? l10n.t('Loading…')
            : series?.available
              ? descriptor.seriesLabel
              : unavailableCaption(series?.reason);

    if (chartAffordances) {
        return (
            <div
                className={mergeClasses(styles.interactiveCard, !selected && styles.interactiveUnselected)}
                style={{
                    ...selectedStyle,
                    borderLeftColor: group.color,
                    borderLeftWidth: selected ? 6 : 3,
                    paddingLeft: selected ? 0 : 3,
                }}
            >
                <button
                    type="button"
                    className={mergeClasses(styles.tile, styles.cardButton)}
                    aria-pressed={selected}
                    aria-describedby={groupLabelId}
                    onClick={onSelect}
                >
                    <Text className={styles.label} style={selectedTextStyle}>
                        {descriptor.label}
                    </Text>
                    <Text className={styles.value} style={selectedTextStyle}>
                        {value}
                    </Text>
                    <Text className={styles.caption} style={selectedTextStyle}>
                        {caption}
                    </Text>
                </button>
                <Button
                    className={styles.eye}
                    appearance="subtle"
                    size="small"
                    icon={<Eye16Regular aria-hidden="true" />}
                    aria-label={l10n.t('Show chart: {metric}', { metric: descriptor.label })}
                    aria-pressed={selected}
                    onClick={onSelect}
                />
            </div>
        );
    }

    return (
        <button
            type="button"
            className={styles.tile}
            style={{
                ...selectedStyle,
                borderLeftColor: group.color,
                boxShadow: selected ? `0 0 0 ${tokens.strokeWidthThin} ${group.border}` : undefined,
            }}
            aria-pressed={selected}
            onClick={onSelect}
        >
            <Text className={styles.label} style={selectedTextStyle}>
                {descriptor.label}
            </Text>
            <Text className={styles.value} style={selectedTextStyle}>
                {value}
            </Text>
            <Text className={styles.caption} style={selectedTextStyle}>
                {caption}
            </Text>
            <Text className={styles.visuallyHidden}>{group.label}</Text>
        </button>
    );
};
