/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Dropdown, Field, Input, makeStyles, Option, tokens } from '@fluentui/react-components';
import { AddRegular, DismissRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { InlineGuidance, MetricPill, PillRow, SubPanel } from '../components/primitives';
import { getActiveContainer, getAvgDocSizeKb, updateActiveContainer, type DataModel } from '../dataModel';
import { type ReadQuery, type WriteOps } from '../models';
import { queryPropertyNames, readFilterProperties } from '../queryFilterProperties';
import { nextId } from '../scenarios';

/**
 * Queries tab of a container step. Self-contained editor for the active container's read
 * patterns and write rates. RU estimates are illustrative (prototype), derived from doc size.
 */

const useStyles = makeStyles({
    readRow: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 96px 32px',
        gap: tokens.spacingHorizontalS,
        alignItems: 'end',
        marginBottom: tokens.spacingVerticalM,
        '@media (max-width: 560px)': {
            gridTemplateColumns: 'minmax(0, 1fr) 80px 32px',
        },
    },
    queryRow: {
        gridColumn: '1 / -1',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
        gap: tokens.spacingHorizontalS,
        alignItems: 'start',
        minWidth: 0,
    },
    input: {
        minWidth: 0,
        width: '100%',
    },
    addRead: {
        alignSelf: 'flex-start',
    },
    writeGrid: {
        display: 'grid',
        maxWidth: '600px',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: tokens.spacingHorizontalM,
        marginBottom: tokens.spacingVerticalM,
    },
    writeCell: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
        minWidth: 0,
    },
    stack: {
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        gap: tokens.spacingVerticalM,
    },
});

export interface QueriesPageProps {
    model: DataModel;
    onChange: (next: DataModel) => void;
}

export function QueriesPage({ model, onChange }: QueriesPageProps) {
    const styles = useStyles();
    const patternLabel = l10n.t('Description');
    const queryLabel = l10n.t('Query');
    const filtersLabel = l10n.t('Filters on');
    const qpsLabel = l10n.t('Peak QPS');

    // Queries are per-container: edit the active container's reads and write rates.
    const active = getActiveContainer(model);
    const reads = active?.reads ?? [];
    const propertyNames = [...new Set(active?.properties.map((property) => property.name).filter(Boolean) ?? [])];
    const writes = active?.writes ?? { insertsPerSec: 0, updatesPerSec: 0, deletesPerSec: 0 };
    const avgDocSizeKb = getAvgDocSizeKb(model);
    const onChangeReads = (next: ReadQuery[]) => onChange(updateActiveContainer(model, (c) => ({ ...c, reads: next })));
    const onChangeWrites = (next: WriteOps) => onChange(updateActiveContainer(model, (c) => ({ ...c, writes: next })));

    const patchRead = (id: string, patch: Partial<ReadQuery>) =>
        onChangeReads(reads.map((r) => (r.id === id ? { ...r, ...patch } : r)));

    const addRead = () =>
        onChangeReads([...reads, { id: nextId('read'), pattern: '', query: '', filters: [], qps: 0 }]);

    const removeRead = (id: string) => onChangeReads(reads.filter((r) => r.id !== id));

    const totalTps = writes.insertsPerSec + writes.updatesPerSec + writes.deletesPerSec;
    // Rough planning-only RU estimates: ~1 RU per KB for a point read, doubled for a write.
    const readRu = Math.max(1, Math.round(avgDocSizeKb));
    const writeRu = Math.max(2, Math.round(avgDocSizeKb * 3));

    return (
        <div className={styles.stack}>
            <SubPanel
                title={'📖 ' + l10n.t('Reads')}
                count={l10n.t('{count} queries', { count: reads.length })}
                subtitle={l10n.t(
                    'List each read pattern, its full SQL query, filter properties, and peak queries per second (QPS). The highest-QPS query should drive the partition key.',
                )}
            >
                <InlineGuidance title={l10n.t('Query alignment is critical')}>
                    <ul>
                        <li>{l10n.t('Single-partition: ~1-5 RU, <10ms')}</li>
                        <li>{l10n.t('Cross-partition: 10-100× more RU')}</li>
                        <li>{l10n.t('Optimize for the 80% case')}</li>
                    </ul>
                    <p>{l10n.t('“Get all X for Y” → Y is your partition key candidate.')}</p>
                </InlineGuidance>
                {reads.map((r, index) => {
                    const selected = readFilterProperties(r);
                    const referenced = queryPropertyNames(r.query ?? '');
                    const missing = selected.filter((name) => !referenced.names.includes(name));
                    const unknown = selected.filter((name) => !propertyNames.includes(name));
                    const warning = unknown.length
                        ? l10n.t('Properties no longer in this container: {properties}', {
                              properties: unknown.join(', '),
                          })
                        : !referenced.valid
                          ? l10n.t('Finish the SQL query to validate selected properties.')
                          : missing.length
                            ? l10n.t('Selected properties not referenced in the query: {properties}', {
                                  properties: missing.join(', '),
                              })
                            : undefined;
                    return (
                        <div key={r.id} className={styles.readRow}>
                            <Field label={patternLabel} className={styles.input}>
                                <Input
                                    className={styles.input}
                                    aria-label={l10n.t('{label} for read {n}', { label: patternLabel, n: index + 1 })}
                                    value={r.pattern}
                                    placeholder={l10n.t('e.g., Get all orders for a customer')}
                                    onChange={(_, data) => patchRead(r.id, { pattern: data.value })}
                                />
                            </Field>
                            <Field label={qpsLabel}>
                                <Input
                                    className={styles.input}
                                    aria-label={l10n.t('{label} for read {n}', { label: qpsLabel, n: index + 1 })}
                                    type="number"
                                    value={String(r.qps)}
                                    onChange={(_, data) => patchRead(r.id, { qps: Number(data.value) || 0 })}
                                />
                            </Field>
                            <Button
                                icon={<DismissRegular />}
                                appearance="subtle"
                                size="small"
                                aria-label={l10n.t('Remove read query')}
                                onClick={() => removeRead(r.id)}
                            />
                            <div className={styles.queryRow}>
                                <Field label={queryLabel} className={styles.input}>
                                    <Input
                                        className={styles.input}
                                        aria-label={l10n.t('{label} for read {n}', { label: queryLabel, n: index + 1 })}
                                        value={r.query ?? ''}
                                        placeholder="SELECT * FROM c WHERE customerId = @customerId"
                                        onChange={(_, data) => {
                                            const next = queryPropertyNames(data.value);
                                            patchRead(r.id, {
                                                query: data.value,
                                                filters: next.valid
                                                    ? [
                                                          ...new Set([
                                                              ...selected,
                                                              ...propertyNames.filter((name) =>
                                                                  next.names.includes(name),
                                                              ),
                                                          ]),
                                                      ]
                                                    : selected,
                                            });
                                        }}
                                    />
                                </Field>
                                <Field
                                    label={filtersLabel}
                                    className={styles.input}
                                    validationState={warning ? 'warning' : 'none'}
                                    validationMessage={warning ? { children: warning, role: 'status' } : undefined}
                                >
                                    <Dropdown
                                        className={styles.input}
                                        aria-label={l10n.t('{label} for read {n}', {
                                            label: filtersLabel,
                                            n: index + 1,
                                        })}
                                        multiselect
                                        selectedOptions={selected}
                                        value={selected.join(', ')}
                                        placeholder={l10n.t('Select properties')}
                                        onOptionSelect={(_, data) => patchRead(r.id, { filters: data.selectedOptions })}
                                    >
                                        {[...propertyNames, ...unknown].map((name) => (
                                            <Option key={name} value={name}>
                                                {name}
                                            </Option>
                                        ))}
                                    </Dropdown>
                                </Field>
                            </div>
                        </div>
                    );
                })}
                <Button className={styles.addRead} icon={<AddRegular />} appearance="subtle" onClick={addRead}>
                    {l10n.t('Add read query')}
                </Button>
            </SubPanel>

            <SubPanel
                title={'✍️ ' + l10n.t('Writes')}
                count={`${totalTps} TPS`}
                subtitle={l10n.t(
                    'Estimate peak transactions per second (TPS). TPS is the combined number of insert, update, and delete operations per second.',
                )}
            >
                <div className={styles.writeGrid}>
                    <Field className={styles.writeCell} label={l10n.t('Inserts / sec')}>
                        <Input
                            className={styles.input}
                            type="number"
                            value={String(writes.insertsPerSec)}
                            onChange={(_, data) =>
                                onChangeWrites({ ...writes, insertsPerSec: Number(data.value) || 0 })
                            }
                        />
                    </Field>
                    <Field className={styles.writeCell} label={l10n.t('Updates / sec')}>
                        <Input
                            className={styles.input}
                            type="number"
                            value={String(writes.updatesPerSec)}
                            onChange={(_, data) =>
                                onChangeWrites({ ...writes, updatesPerSec: Number(data.value) || 0 })
                            }
                        />
                    </Field>
                    <Field className={styles.writeCell} label={l10n.t('Deletes / sec')}>
                        <Input
                            className={styles.input}
                            type="number"
                            value={String(writes.deletesPerSec)}
                            onChange={(_, data) =>
                                onChangeWrites({ ...writes, deletesPerSec: Number(data.value) || 0 })
                            }
                        />
                    </Field>
                </div>
            </SubPanel>

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
    );
}
