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
import { useId, useState } from 'react';
import { summarizeStorage } from '../../../../panels/accountOverview/metrics/storage';
import { type MetricApplicability, type MetricSeriesResult } from '../../../api/types';
import { ThemedTooltip as Tooltip } from '../../../common/ThemedTooltip';
import {
    formatMetricValue,
    METRIC_GROUPS,
    metricInapplicabilityExplanation,
    type MetricViewDescriptor,
    tileScalar,
    storageDescription,
    unavailableCaption,
} from './descriptors';

// ─── Metric tile ────────────────────────────────────────────────────────────────
//
// A selectable scalar tile for one metric. Clicking it selects the metric whose
// chart is expanded inline below the tile row (see `MetricsSection`). The scalar is
// derived from the series via the descriptor's tile-pick; an unavailable series
// renders a muted em dash rather than an error.

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
    applicability = series?.applicability,
    loading,
    selected,
    onSelect,
    chartAffordances = false,
    groupLabelId,
}: {
    descriptor: MetricViewDescriptor;
    series?: MetricSeriesResult;
    applicability?: MetricApplicability;
    loading: boolean;
    selected: boolean;
    onSelect: () => void;
    chartAffordances?: boolean;
    groupLabelId?: string;
}) => {
    const styles = useStyles();
    const explanationId = useId();
    const [tooltipVisible, setTooltipVisible] = useState(false);
    const notApplicable = applicability?.status === 'notApplicable';
    const explanation = notApplicable
        ? metricInapplicabilityExplanation(applicability.reason)
        : series?.storage
          ? storageDescription(series.storage)
          : undefined;
    const describedBy = [groupLabelId, explanation ? explanationId : undefined].filter(Boolean).join(' ') || undefined;
    const group = notApplicable
        ? {
              ...METRIC_GROUPS[descriptor.group],
              color: tokens.colorNeutralForeground2,
              background: tokens.colorNeutralBackground2,
              border: tokens.colorNeutralStrokeAccessible,
          }
        : METRIC_GROUPS[descriptor.group];
    const selectedStyle = selected
        ? {
              backgroundColor: group.background,
              borderTopColor: group.border,
              borderRightColor: group.border,
              borderBottomColor: group.border,
          }
        : undefined;
    const selectedTextStyle = selected ? { color: group.color } : undefined;

    const hasData = !notApplicable && series?.available;
    const storageSummary = series?.storage ? summarizeStorage(series.storage) : undefined;
    const scalar = hasData
        ? storageSummary
            ? storageSummary.bytes
            : tileScalar(descriptor, series.points, series.peak)
        : undefined;
    const value = hasData ? formatMetricValue(descriptor.unit, scalar) : '—';
    const caption = notApplicable
        ? l10n.t('Not applicable')
        : loading && !series
          ? l10n.t('Loading…')
          : storageSummary?.status === 'partial'
            ? l10n.t('Partial data')
            : series?.available
              ? descriptor.seriesLabel
              : unavailableCaption(series?.reason);

    const tile = chartAffordances ? (
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
                aria-describedby={describedBy}
                onClick={onSelect}
            >
                <Text block className={styles.label} style={selectedTextStyle}>
                    {descriptor.label}
                </Text>
                <Text block className={styles.value} style={selectedTextStyle}>
                    {value}
                </Text>
                <Text block className={styles.caption} style={selectedTextStyle}>
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
                aria-describedby={describedBy}
                onClick={onSelect}
            />
        </div>
    ) : (
        <button
            type="button"
            className={styles.tile}
            style={{
                ...selectedStyle,
                borderLeftColor: group.color,
                boxShadow: selected ? `0 0 0 ${tokens.strokeWidthThin} ${group.border}` : undefined,
            }}
            aria-pressed={selected}
            aria-describedby={describedBy}
            onClick={onSelect}
        >
            <Text block className={styles.label} style={selectedTextStyle}>
                {descriptor.label}
            </Text>
            <Text block className={styles.value} style={selectedTextStyle}>
                {value}
            </Text>
            <Text block className={styles.caption} style={selectedTextStyle}>
                {caption}
            </Text>
            {!groupLabelId && <Text className={styles.visuallyHidden}>{group.label}</Text>}
        </button>
    );

    // Keep the wrapper mounted when applicability changes so a focused tile or eye button is not replaced.
    return (
        <Tooltip
            content={{ id: explanationId, children: explanation ?? '' }}
            relationship={explanation ? 'description' : 'inaccessible'}
            visible={!!explanation && tooltipVisible}
            onVisibleChange={(_, data) => setTooltipVisible(!!explanation && data.visible)}
        >
            {tile}
        </Tooltip>
    );
};
