/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Input, makeStyles, Text, tokens } from '@fluentui/react-components';
import { AddRegular, DismissRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { MetricPill, PillRow, SectionHead, SidebarInfo, SubPanel, TwoColumn } from '../components/primitives';
import { getActiveContainer, getAvgDocSizeKb, type DataModel, updateActiveContainer } from '../dataModel';
import { type ReadQuery, type WriteOps } from '../models';
import { nextId } from '../scenarios';

/**
 * Step 3 — Queries. Self-contained editor for read patterns and write rates.
 * RU estimates are illustrative (prototype), derived from the passed doc size.
 */

const useStyles = makeStyles({
    readRow: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 140px 96px 32px',
        gap: tokens.spacingHorizontalS,
        alignItems: 'center',
        marginBottom: tokens.spacingVerticalXS,
        '@media (max-width: 560px)': {
            gridTemplateColumns: '1fr 1fr',
        },
    },
    headRow: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
        '@media (max-width: 560px)': {
            display: 'none',
        },
    },
    writeGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: tokens.spacingHorizontalM,
        marginBottom: tokens.spacingVerticalM,
    },
    writeCell: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
    },
    stack: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
    },
});

export interface QueriesPageProps {
    model: DataModel;
    onChange: (next: DataModel) => void;
}

export function QueriesPage({ model, onChange }: QueriesPageProps) {
    const styles = useStyles();

    // Queries are per-container: edit the active container's reads and write rates.
    const active = getActiveContainer(model);
    const reads = active?.reads ?? [];
    const writes = active?.writes ?? { insertsPerSec: 0, updatesPerSec: 0, deletesPerSec: 0 };
    const avgDocSizeKb = getAvgDocSizeKb(model);
    const onChangeReads = (next: ReadQuery[]) => onChange(updateActiveContainer(model, (c) => ({ ...c, reads: next })));
    const onChangeWrites = (next: WriteOps) => onChange(updateActiveContainer(model, (c) => ({ ...c, writes: next })));

    const patchRead = (id: string, patch: Partial<ReadQuery>) =>
        onChangeReads(reads.map((r) => (r.id === id ? { ...r, ...patch } : r)));

    const addRead = () => onChangeReads([...reads, { id: nextId('read'), pattern: '', filters: '', qps: 0 }]);

    const removeRead = (id: string) => onChangeReads(reads.filter((r) => r.id !== id));

    const totalTps = writes.insertsPerSec + writes.updatesPerSec + writes.deletesPerSec;
    // Rough planning-only RU estimates: ~1 RU per KB for a point read, doubled for a write.
    const readRu = Math.max(1, Math.round(avgDocSizeKb));
    const writeRu = Math.max(2, Math.round(avgDocSizeKb * 3));

    return (
        <div>
            <TwoColumn>
                <SidebarInfo
                    title={l10n.t('Query alignment is critical')}
                    items={[
                        l10n.t('Single-partition: ~1-5 RU, <10ms'),
                        l10n.t('Cross-partition: 10-100× more RU'),
                        l10n.t('Optimize for the 80% case'),
                    ]}
                    note={l10n.t('“Get all X for Y” → Y is your partition key candidate.')}
                />

                <div className={styles.stack}>
                    <div>
                        <SectionHead count={l10n.t('{count} queries', { count: reads.length })}>
                            {l10n.t('📖 Reads')}
                        </SectionHead>
                        <Text className={styles.headRow} as="p">
                            {l10n.t(
                                'List each read pattern, the attribute(s) it filters on, and its peak queries per second (QPS). The highest-QPS query should drive the partition key.',
                            )}
                        </Text>
                        <div className={`${styles.readRow} ${styles.headRow}`}>
                            <span>{l10n.t('Query pattern')}</span>
                            <span>{l10n.t('Filters on')}</span>
                            <span>{l10n.t('Peak QPS')}</span>
                            <span />
                        </div>
                        {reads.map((r) => (
                            <div key={r.id} className={styles.readRow}>
                                <Input
                                    value={r.pattern}
                                    placeholder={l10n.t('e.g., Get all orders for a customer')}
                                    onChange={(_, data) => patchRead(r.id, { pattern: data.value })}
                                />
                                <Input
                                    value={r.filters}
                                    placeholder={l10n.t('customerId')}
                                    onChange={(_, data) => patchRead(r.id, { filters: data.value })}
                                />
                                <Input
                                    type="number"
                                    value={String(r.qps)}
                                    onChange={(_, data) => patchRead(r.id, { qps: Number(data.value) || 0 })}
                                />
                                <Button
                                    icon={<DismissRegular />}
                                    appearance="subtle"
                                    size="small"
                                    aria-label={l10n.t('Remove read query')}
                                    onClick={() => removeRead(r.id)}
                                />
                            </div>
                        ))}
                        <Button icon={<AddRegular />} appearance="subtle" onClick={addRead}>
                            {l10n.t('Add read query')}
                        </Button>
                    </div>

                    <div>
                        <SectionHead count={`${totalTps} TPS`}>{l10n.t('✍️ Writes')}</SectionHead>
                        <Text className={styles.headRow} as="p">
                            {l10n.t(
                                'Estimate peak transactions per second (TPS). TPS is the combined number of insert, update, and delete operations per second.',
                            )}
                        </Text>
                        <div className={styles.writeGrid}>
                            <div className={styles.writeCell}>
                                <label>{l10n.t('Inserts / sec')}</label>
                                <Input
                                    type="number"
                                    value={String(writes.insertsPerSec)}
                                    onChange={(_, data) =>
                                        onChangeWrites({ ...writes, insertsPerSec: Number(data.value) || 0 })
                                    }
                                />
                            </div>
                            <div className={styles.writeCell}>
                                <label>{l10n.t('Updates / sec')}</label>
                                <Input
                                    type="number"
                                    value={String(writes.updatesPerSec)}
                                    onChange={(_, data) =>
                                        onChangeWrites({ ...writes, updatesPerSec: Number(data.value) || 0 })
                                    }
                                />
                            </div>
                            <div className={styles.writeCell}>
                                <label>{l10n.t('Deletes / sec')}</label>
                                <Input
                                    type="number"
                                    value={String(writes.deletesPerSec)}
                                    onChange={(_, data) =>
                                        onChangeWrites({ ...writes, deletesPerSec: Number(data.value) || 0 })
                                    }
                                />
                            </div>
                        </div>
                    </div>

                    <SubPanel
                        title={l10n.t('Estimated request cost')}
                        subtitle={l10n.t(
                            'Planning estimates only: actual request unit (RU) cost varies with indexing, payload shape, consistency, and query complexity.',
                        )}
                    >
                        <PillRow>
                            <MetricPill>{l10n.t('~{ru} RU / point read', { ru: readRu })}</MetricPill>
                            <MetricPill>{l10n.t('~{ru} RU / write', { ru: writeRu })}</MetricPill>
                        </PillRow>
                    </SubPanel>
                </div>
            </TwoColumn>
        </div>
    );
}
