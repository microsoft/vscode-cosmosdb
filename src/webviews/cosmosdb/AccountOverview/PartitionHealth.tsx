/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dropdown,
    makeStyles,
    mergeClasses,
    Option,
    Spinner,
    Text,
    tokens,
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
 * Heat ramp toward `--vscode-errorForeground`. Text stays on `--vscode-foreground`
 * and the fill is mixed against the editor background so every level keeps
 * legible contrast in dark, light, and high-contrast themes; hot partitions get
 * a solid error-colored border in addition to the deepest fill.
 */
const LEVEL_FILL: Record<PartitionIntensityLevel, string> = {
    1: 'color-mix(in srgb, var(--vscode-errorForeground) 10%, var(--vscode-editor-background))',
    2: 'color-mix(in srgb, var(--vscode-errorForeground) 22%, var(--vscode-editor-background))',
    3: 'color-mix(in srgb, var(--vscode-errorForeground) 36%, var(--vscode-editor-background))',
    4: 'color-mix(in srgb, var(--vscode-errorForeground) 52%, var(--vscode-editor-background))',
    5: 'color-mix(in srgb, var(--vscode-errorForeground) 70%, var(--vscode-editor-background))',
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
        minWidth: '220px',
    },
    modeToggle: {
        display: 'flex',
        gap: tokens.spacingHorizontalXS,
    },
    stats: {
        display: 'flex',
        gap: tokens.spacingHorizontalL,
        flexWrap: 'wrap',
        color: 'var(--vscode-descriptionForeground)',
        fontSize: tokens.fontSizeBase200,
    },
    statValue: {
        color: 'var(--vscode-foreground)',
        fontWeight: tokens.fontWeightSemibold,
    },
    heatmap: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
        gap: tokens.spacingHorizontalS,
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
    tile: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: tokens.spacingHorizontalS,
        borderRadius: tokens.borderRadiusMedium,
        border: '1px solid var(--vscode-widget-border, var(--vscode-panel-border))',
        color: 'var(--vscode-foreground)',
        minWidth: 0,
    },
    tileHot: {
        border: '1px solid var(--vscode-errorForeground)',
    },
    tileId: {
        fontFamily: 'var(--vscode-editor-font-family)',
        fontSize: tokens.fontSizeBase200,
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
        gap: '2px',
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        border: '1px solid var(--vscode-widget-border, var(--vscode-panel-border))',
        backgroundColor: 'var(--vscode-editor-background)',
    },
    listItemHot: {
        borderLeft: '3px solid var(--vscode-errorForeground)',
    },
    listTitleRow: {
        display: 'flex',
        alignItems: 'baseline',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
    },
    listTitle: {
        fontFamily: 'var(--vscode-editor-font-family)',
        fontWeight: tokens.fontWeightSemibold,
    },
    hotTag: {
        color: 'var(--vscode-errorForeground)',
        fontSize: tokens.fontSizeBase200,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
    },
    rationale: {
        fontSize: tokens.fontSizeBase200,
        color: 'var(--vscode-foreground)',
    },
    action: {
        fontSize: tokens.fontSizeBase200,
        color: 'var(--vscode-descriptionForeground)',
    },
    emptyState: {
        padding: tokens.spacingVerticalXL,
        textAlign: 'center',
        color: 'var(--vscode-descriptionForeground)',
    },
    loading: {
        display: 'flex',
        justifyContent: 'center',
        padding: tokens.spacingVerticalXL,
    },
});

function formatShare(sharePercent: number): string {
    if (!Number.isFinite(sharePercent)) {
        return '—';
    }
    const rounded = sharePercent >= 10 ? Math.round(sharePercent) : Math.round(sharePercent * 10) / 10;
    return `${rounded}%`;
}

function partitionLabel(partitionId: string): string {
    return `PKR-${partitionId}`;
}

function rationaleFor(tile: PartitionTile, mode: PartitionDistributionMode): string {
    const percent = Math.round(tile.sharePercent);
    if (mode === 'ru') {
        return tile.hot
            ? l10n.t(
                  'This physical partition ran at {percent}% p99 utilization while a cooler partition still had headroom — load is skewed by the partition key.',
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
    const percent = Math.round(tile.sharePercent);
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
            <figcaption className={styles.srOnly}>{tileAriaLabel(tile, mode)}</figcaption>
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
    result,
    loading,
    mode,
    onModeChange,
    containers,
    selected,
    onSelectContainer,
}: {
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
    const selectedText = selected ? selected.containerId : l10n.t('Select a container');

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
                className={styles.containerSelect}
                aria-label={l10n.t('Select a container for partition health')}
                value={selectedText}
                selectedOptions={[selectedValue]}
                onOptionSelect={handleSelect}
            >
                {containers.map((c) => {
                    const value = `${c.databaseId}/${c.containerId}`;
                    return (
                        <Option key={value} value={value} text={c.containerId}>
                            {`${c.containerId} · ${c.databaseId}`}
                        </Option>
                    );
                })}
            </Dropdown>
            <div className={styles.modeToggle} role="toolbar" aria-label={l10n.t('Partition distribution measure')}>
                <Button
                    size="small"
                    appearance={mode === 'ru' ? 'primary' : 'subtle'}
                    aria-pressed={mode === 'ru'}
                    onClick={() => onModeChange('ru')}
                >
                    {l10n.t('By RU Share')}
                </Button>
                <Button
                    size="small"
                    appearance={mode === 'storage' ? 'primary' : 'subtle'}
                    aria-pressed={mode === 'storage'}
                    onClick={() => onModeChange('storage')}
                >
                    {l10n.t('By Storage Share')}
                </Button>
            </div>
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
                <figure className={styles.heatmap} style={{ margin: 0 }}>
                    <figcaption className={styles.srOnly}>
                        {l10n.t('Partition distribution heatmap with {count} physical partitions', {
                            count: result.partitionCount,
                        })}
                    </figcaption>
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
                                    {tile.hot && <Text className={styles.hotTag}>{l10n.t('Hot')}</Text>}
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
