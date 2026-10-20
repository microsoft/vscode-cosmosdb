/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Dropdown,
    makeStyles,
    mergeClasses,
    Option,
    Spinner,
    Text,
    tokens,
    Toolbar,
    ToolbarToggleButton,
    typographyStyles,
    type OptionOnSelectData,
} from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type ReactNode } from 'react';
import {
    type PartitionDistributionMode,
    type PartitionHealthResult,
    type PartitionIntensityLevel,
    type PartitionTile,
} from '../../api/types';
import { EmptyState } from './DashboardChrome';
import { type ContainerRef } from './metrics/descriptors';

const NO_CONTAINER = 'none';

/**
 * The heat ramp uses Fluent's danger surface pair. Hot partitions also have a danger border and a textual badge;
 * intensity is not the only indication of a hot partition.
 */
const LEVEL_FILL: Record<PartitionIntensityLevel, string> = {
    1: `color-mix(in srgb, ${tokens.colorStatusDangerBackground1} 10%, ${tokens.colorNeutralBackground1})`,
    2: `color-mix(in srgb, ${tokens.colorStatusDangerBackground1} 22%, ${tokens.colorNeutralBackground1})`,
    3: `color-mix(in srgb, ${tokens.colorStatusDangerBackground1} 36%, ${tokens.colorNeutralBackground1})`,
    4: `color-mix(in srgb, ${tokens.colorStatusDangerBackground1} 52%, ${tokens.colorNeutralBackground1})`,
    5: `color-mix(in srgb, ${tokens.colorStatusDangerBackground1} 70%, ${tokens.colorNeutralBackground1})`,
};

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
    },
    toolbar: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalM,
        flexWrap: 'wrap',
    },
    containerSelect: {
        minWidth: 0,
        width: '220px',
        maxWidth: '100%',
    },
    stats: {
        ...typographyStyles.body1,
        display: 'flex',
        gap: tokens.spacingHorizontalL,
        flexWrap: 'wrap',
        color: tokens.colorNeutralForeground2,
    },
    statValue: {
        color: tokens.colorNeutralForeground1,
        fontWeight: tokens.fontWeightSemibold,
    },
    heatmap: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
        gap: tokens.spacingHorizontalS,
    },
    tile: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
        padding: tokens.spacingHorizontalS,
        borderRadius: tokens.borderRadiusMedium,
        border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
        color: tokens.colorStatusDangerForeground1,
        minWidth: 0,
    },
    tileHot: {
        border: `${tokens.strokeWidthThin} solid ${tokens.colorStatusDangerBorder1}`,
    },
    tileId: {
        ...typographyStyles.body1,
        fontFamily: tokens.fontFamilyMonospace,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    tileShare: {
        fontWeight: tokens.fontWeightSemibold,
    },
    list: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
    },
    listItem: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
        backgroundColor: tokens.colorNeutralBackground1,
    },
    listItemHot: {
        borderLeft: `${tokens.strokeWidthThicker} solid ${tokens.colorStatusDangerBorder1}`,
    },
    listTitleRow: {
        display: 'flex',
        alignItems: 'baseline',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
    },
    listTitle: {
        ...typographyStyles.body1Strong,
        fontFamily: tokens.fontFamilyMonospace,
    },
    rationale: {
        ...typographyStyles.body1,
        color: tokens.colorNeutralForeground1,
    },
    action: {
        ...typographyStyles.body1,
        color: tokens.colorNeutralForeground2,
    },
    emptyState: {
        padding: tokens.spacingVerticalXL,
        textAlign: 'center',
        color: tokens.colorNeutralForeground2,
    },
    loading: {
        display: 'flex',
        justifyContent: 'center',
        padding: tokens.spacingVerticalXL,
    },
});

function roundShare(sharePercent: number): number {
    return sharePercent >= 10 ? Math.round(sharePercent) : Math.round(sharePercent * 10) / 10;
}

function formatShare(sharePercent: number): string {
    if (!Number.isFinite(sharePercent)) {
        return '—';
    }
    return `${roundShare(sharePercent)}%`;
}

function partitionLabel(partitionId: string): string {
    return `PKR-${partitionId}`;
}

function rationaleFor(tile: PartitionTile, mode: PartitionDistributionMode): string {
    const percent = roundShare(tile.sharePercent);
    if (mode === 'ru') {
        return tile.hot
            ? l10n.t(
                  'This physical partition ran at {percent}% p99 utilization while a cooler partition still had headroom. Load is skewed by the partition key.',
                  { percent },
              )
            : l10n.t('Ran at {percent}% p99 utilization.', { percent });
    }
    return tile.hot
        ? l10n.t('Single physical partition holds {percent}% of storage, indicating skewed distribution.', { percent })
        : l10n.t('Holds {percent}% of container storage.', { percent });
}

function suggestedActionFor(tile: PartitionTile, mode: PartitionDistributionMode): string | undefined {
    if (!tile.hot) {
        return undefined;
    }
    return mode === 'ru'
        ? l10n.t('Suggested action: choose a higher-cardinality partition key to spread load more evenly.')
        : l10n.t('Suggested action: revisit the partition key to rebalance storage across partitions.');
}

function tileAriaLabel(tile: PartitionTile, mode: PartitionDistributionMode): string {
    const label = partitionLabel(tile.partitionId);
    const percent = roundShare(tile.sharePercent);
    if (mode === 'ru') {
        return tile.hot
            ? l10n.t('Physical partition {0}, {1} percent p99 utilization, flagged as hot', label, percent)
            : l10n.t('Physical partition {0}, {1} percent p99 utilization', label, percent);
    }
    return tile.hot
        ? l10n.t('Physical partition {0}, {1} percent of storage, flagged as hot', label, percent)
        : l10n.t('Physical partition {0}, {1} percent of storage', label, percent);
}

const HeatmapTile = ({ tile, mode }: { tile: PartitionTile; mode: PartitionDistributionMode }) => {
    const styles = useStyles();
    return (
        <figure
            className={mergeClasses(styles.tile, tile.hot && styles.tileHot)}
            style={{ backgroundColor: LEVEL_FILL[tile.level], margin: 0 }}
            aria-label={tileAriaLabel(tile, mode)}
            title={
                mode === 'ru'
                    ? l10n.t('{label}: {value} p99 utilization', {
                          label: partitionLabel(tile.partitionId),
                          value: formatShare(tile.sharePercent),
                      })
                    : l10n.t('{label}: {share} share', {
                          label: partitionLabel(tile.partitionId),
                          share: formatShare(tile.sharePercent),
                      })
            }
        >
            <Text className={styles.tileId} aria-hidden="true">
                {partitionLabel(tile.partitionId)}
            </Text>
            <Text className={styles.tileShare} aria-hidden="true">
                {formatShare(tile.sharePercent)}
            </Text>
        </figure>
    );
};

export const PartitionHealth = ({
    active = true,
    navigationRevision = 0,
    result,
    loading,
    mode,
    onModeChange,
    containers,
    selected,
    onSelectContainer,
}: {
    active?: boolean;
    navigationRevision?: number;
    result?: PartitionHealthResult;
    loading: boolean;
    mode: PartitionDistributionMode;
    onModeChange: (mode: PartitionDistributionMode) => void;
    containers: ContainerRef[];
    selected?: ContainerRef;
    onSelectContainer: (container: ContainerRef) => void;
}) => {
    const styles = useStyles();

    const selectedValue = selected ? `${selected.databaseId}/${selected.containerId}` : NO_CONTAINER;
    const selectedText = selected ? `${selected.containerId} · ${selected.databaseId}` : l10n.t('Select a container');

    const handleSelect = (_: unknown, data: OptionOnSelectData) => {
        const value = data.optionValue;
        if (!value || value === NO_CONTAINER) {
            return;
        }
        const slash = value.indexOf('/');
        onSelectContainer({ databaseId: value.slice(0, slash), containerId: value.slice(slash + 1) });
    };

    const toolbar = (
        <div className={styles.toolbar}>
            <Dropdown
                key={`${active}-${navigationRevision}`}
                className={styles.containerSelect}
                aria-label={l10n.t('Select a container for partition health: {selection}', {
                    selection: selectedText,
                })}
                value={selectedText}
                selectedOptions={[selectedValue]}
                onOptionSelect={handleSelect}
            >
                {containers.map((c) => {
                    const value = `${c.databaseId}/${c.containerId}`;
                    const text = `${c.containerId} · ${c.databaseId}`;
                    return (
                        <Option key={value} value={value} text={text}>
                            {text}
                        </Option>
                    );
                })}
            </Dropdown>
            <Toolbar
                size="small"
                aria-label={l10n.t('Partition distribution measure')}
                checkedValues={{ mode: [mode] }}
            >
                <ToolbarToggleButton name="mode" value="ru" onClick={() => onModeChange('ru')}>
                    {l10n.t('By RU Share')}
                </ToolbarToggleButton>
                <ToolbarToggleButton name="mode" value="storage" onClick={() => onModeChange('storage')}>
                    {l10n.t('By Storage Share')}
                </ToolbarToggleButton>
            </Toolbar>
        </div>
    );

    let body: ReactNode;
    if (containers.length === 0) {
        body = (
            <Text className={styles.emptyState}>
                {l10n.t('This account has no containers to analyze for partition distribution.')}
            </Text>
        );
    } else if (loading && !result) {
        body = (
            <div className={styles.loading}>
                <Spinner size="small" label={l10n.t('Loading partition telemetry…')} />
            </div>
        );
    } else if (!selected) {
        body = (
            <Text className={styles.emptyState}>{l10n.t('Select a container to view partition distribution.')}</Text>
        );
    } else if (!result || !result.available || result.tiles.length === 0) {
        body = <EmptyState reason={result?.reason ?? 'noData'} requiredRole={l10n.t('Monitoring Reader')} />;
    } else {
        const rankedTiles = result.tiles.slice(0, result.topN);
        body = (
            <div className={styles.root}>
                <div className={styles.stats}>
                    {mode === 'ru' ? (
                        <>
                            <span>
                                {l10n.t('Busiest partition p99:')}{' '}
                                <span className={styles.statValue}>
                                    {formatShare(result.maxSaturationPercent ?? result.topPartitionShare)}
                                </span>
                            </span>
                            <span>
                                {l10n.t('Coolest partition p99:')}{' '}
                                <span className={styles.statValue}>
                                    {formatShare(result.minSaturationPercent ?? 0)}
                                </span>
                            </span>
                        </>
                    ) : (
                        <>
                            <span>
                                {l10n.t('Top partition share:')}{' '}
                                <span className={styles.statValue}>{formatShare(result.topPartitionShare)}</span>
                            </span>
                            <span>
                                {l10n.t('Skew score:')}{' '}
                                <span className={styles.statValue}>{formatShare(result.skewScore)}</span>
                            </span>
                        </>
                    )}
                    <span>
                        {l10n.t('Physical partitions:')}{' '}
                        <span className={styles.statValue}>{result.partitionCount}</span>
                    </span>
                </div>
                <figure
                    className={styles.heatmap}
                    style={{ margin: 0 }}
                    aria-label={l10n.t('Partition distribution heatmap with {count} physical partitions', {
                        count: result.partitionCount,
                    })}
                >
                    {result.tiles.map((tile) => (
                        <HeatmapTile key={tile.partitionId} tile={tile} mode={result.mode} />
                    ))}
                </figure>
                <div className={styles.list}>
                    {rankedTiles.map((tile) => {
                        const action = suggestedActionFor(tile, result.mode);
                        return (
                            <div
                                key={tile.partitionId}
                                className={mergeClasses(styles.listItem, tile.hot && styles.listItemHot)}
                            >
                                <div className={styles.listTitleRow}>
                                    <Text className={styles.listTitle}>
                                        {`${partitionLabel(tile.partitionId)} — ${formatShare(tile.sharePercent)}`}
                                    </Text>
                                    {tile.hot && (
                                        <Badge appearance="tint" shape="circular" color="danger">
                                            {l10n.t('Hot')}
                                        </Badge>
                                    )}
                                </div>
                                <Text className={styles.rationale}>{rationaleFor(tile, result.mode)}</Text>
                                {action && <Text className={styles.action}>{action}</Text>}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    return (
        <div className={styles.root}>
            {toolbar}
            {body}
        </div>
    );
};
