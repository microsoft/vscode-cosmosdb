/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Input,
    makeStyles,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
    tokens,
} from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { FieldGroup, MetricPill, MythBox, PillRow, SidebarInfo, SubPanel, TwoColumn } from '../components/primitives';
import { SelectableCard } from '../components/SelectableCard';
import { getActiveContainer, getAvgDocSizeKb, type DataModel, updateActiveContainer } from '../dataModel';
import { type DataGrowth, type ItemsPerPartition, type ScaleProfile, type WriteDistribution } from '../models';

/**
 * Step 4 — Scale & distribution. Self-contained: distinct-value estimates,
 * items-per-partition, write distribution and growth. The projected size is an
 * illustrative estimate for the prototype.
 */

const useStyles = makeStyles({
    stack: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalL,
    },
    cards: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: tokens.spacingHorizontalS,
    },
    distinctInput: {
        maxWidth: '160px',
    },
    warn: {
        color: tokens.colorPaletteDarkOrangeForeground1,
    },
});

const ITEMS_OPTIONS: { value: ItemsPerPartition; title: string; desc: string; warn?: boolean }[] = [
    { value: 'low', title: '< 1,000 items', desc: 'Profiles, configs' },
    { value: 'medium', title: '1K – 100K items', desc: 'Order history, chat messages' },
    { value: 'high', title: '100K – 1M items', desc: 'Telemetry streams, large tenants' },
    { value: 'very-high', title: '> 1M items ⚠️', desc: 'Will recommend HPK or time-bucketing', warn: true },
];

const WRITE_OPTIONS: { value: WriteDistribution; title: string; desc: string }[] = [
    { value: 'even', title: 'Even', desc: 'Many entities write independently' },
    { value: 'skewed', title: 'Skewed', desc: 'Some entities get dramatically more writes' },
    { value: 'time', title: 'Time-correlated', desc: 'All writes to "current" data' },
];

const GROWTH_OPTIONS: { value: DataGrowth; title: string; desc: string; warn?: boolean }[] = [
    { value: 'bounded', title: 'Bounded', desc: 'Size stabilizes over time' },
    { value: 'slow', title: 'Grows slowly', desc: '~500/year per entity' },
    { value: 'rapid', title: 'Grows rapidly ⚠️', desc: '1000+/day — needs HPK or bucketing', warn: true },
];

const ITEMS_MULTIPLIER: Record<ItemsPerPartition, number> = {
    low: 500,
    medium: 50000,
    high: 500000,
    'very-high': 2000000,
};

function formatCount(n: number): string {
    if (n >= 1_000_000) {
        return `${(n / 1_000_000).toFixed(1)}M`;
    }
    if (n >= 1_000) {
        return `${Math.round(n / 1_000)}K`;
    }
    return String(n);
}

export interface ScalePageProps {
    model: DataModel;
    onChange: (next: DataModel) => void;
}

export function ScalePage({ model, onChange }: ScalePageProps) {
    const styles = useStyles();

    // Scale is per-container: edit the active container's scale profile.
    const active = getActiveContainer(model);
    const scale = active?.scale ?? { candidates: [], items: 'medium', writes: 'even', growth: 'slow' };
    const avgDocSizeKb = getAvgDocSizeKb(model);
    const onChangeScale = (next: ScaleProfile) =>
        onChange(updateActiveContainer(model, (c) => ({ ...c, scale: next })));

    const setDistinct = (id: string, distinctValues: number) =>
        onChangeScale({
            ...scale,
            candidates: scale.candidates.map((c) => (c.id === id ? { ...c, distinctValues } : c)),
        });

    const itemsCount = ITEMS_MULTIPLIER[scale.items];
    const projectedGb = (avgDocSizeKb * itemsCount) / (1024 * 1024);
    const overLimit = projectedGb > 20;

    return (
        <div>
            <TwoColumn>
                <SidebarInfo
                    title={l10n.t('Partition limits')}
                    items={[
                        l10n.t('20 GB per logical partition'),
                        l10n.t('10K RU/s per physical partition'),
                        l10n.t('50 GB per physical partition'),
                    ]}
                    note={l10n.t('Even with 100K RU/s provisioned, one hot partition caps at 10K RU/s.')}
                />

                <div className={styles.stack}>
                    <FieldGroup
                        label={l10n.t('Partition-key candidates — estimated distinct values')}
                        hint={l10n.t(
                            'These are the key & filter attributes from the Data screen. Cardinality (distinct values) drives distribution; higher is better.',
                        )}
                    >
                        <Table size="small" aria-label={l10n.t('Partition-key candidates')}>
                            <TableHeader>
                                <TableRow>
                                    <TableHeaderCell>{l10n.t('Attribute')}</TableHeaderCell>
                                    <TableHeaderCell>{l10n.t('Role')}</TableHeaderCell>
                                    <TableHeaderCell>{l10n.t('Estimated distinct values')}</TableHeaderCell>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {scale.candidates.map((c) => (
                                    <TableRow key={c.id}>
                                        <TableCell>{c.attribute}</TableCell>
                                        <TableCell>{c.role}</TableCell>
                                        <TableCell>
                                            <Input
                                                className={styles.distinctInput}
                                                type="number"
                                                value={String(c.distinctValues)}
                                                onChange={(_, data) => setDistinct(c.id, Number(data.value) || 0)}
                                            />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        <MythBox icon="💰">
                            {l10n.t(
                                'Myth: “1M partition key values will be expensive.” False. Provisioned RU/s is shared across physical partitions and is unrelated to how many logical partition key values you have.',
                            )}
                        </MythBox>
                    </FieldGroup>

                    <FieldGroup label={l10n.t('Items per partition key value')}>
                        <div
                            className={styles.cards}
                            role="radiogroup"
                            aria-label={l10n.t('Items per partition key value')}
                        >
                            {ITEMS_OPTIONS.map((o) => (
                                <SelectableCard
                                    key={o.value}
                                    selected={scale.items === o.value}
                                    onSelect={() => onChangeScale({ ...scale, items: o.value })}
                                    title={<span className={o.warn ? styles.warn : undefined}>{o.title}</span>}
                                    description={o.desc}
                                    ariaLabel={o.title}
                                />
                            ))}
                        </div>
                    </FieldGroup>

                    <FieldGroup label={l10n.t('Write distribution')}>
                        <div className={styles.cards} role="radiogroup" aria-label={l10n.t('Write distribution')}>
                            {WRITE_OPTIONS.map((o) => (
                                <SelectableCard
                                    key={o.value}
                                    selected={scale.writes === o.value}
                                    onSelect={() => onChangeScale({ ...scale, writes: o.value })}
                                    title={o.title}
                                    description={o.desc}
                                    ariaLabel={o.title}
                                />
                            ))}
                        </div>
                    </FieldGroup>

                    <FieldGroup label={l10n.t('Data growth per PK value')}>
                        <div className={styles.cards} role="radiogroup" aria-label={l10n.t('Data growth per PK value')}>
                            {GROWTH_OPTIONS.map((o) => (
                                <SelectableCard
                                    key={o.value}
                                    selected={scale.growth === o.value}
                                    onSelect={() => onChangeScale({ ...scale, growth: o.value })}
                                    title={<span className={o.warn ? styles.warn : undefined}>{o.title}</span>}
                                    description={o.desc}
                                    ariaLabel={o.title}
                                />
                            ))}
                        </div>
                        <SubPanel
                            title={l10n.t('📦 Projected logical-partition size')}
                            subtitle={l10n.t(
                                'Estimated from your avg document size × items per partition key value. The hard limit is 20 GB.',
                            )}
                        >
                            <PillRow>
                                <MetricPill>{l10n.t('avg doc {n} KB', { n: avgDocSizeKb })}</MetricPill>
                                <MetricPill>{l10n.t('× items ~{n}', { n: formatCount(itemsCount) })}</MetricPill>
                                <MetricPill>{l10n.t('≈ {n} GB / partition', { n: projectedGb.toFixed(2) })}</MetricPill>
                            </PillRow>
                            {overLimit ? (
                                <Text className={styles.warn}>
                                    {l10n.t(
                                        '⚠️ Projected size exceeds the 20 GB limit — consider a hierarchical partition key or time-bucketing.',
                                    )}
                                </Text>
                            ) : null}
                        </SubPanel>
                    </FieldGroup>
                </div>
            </TwoColumn>
        </div>
    );
}
