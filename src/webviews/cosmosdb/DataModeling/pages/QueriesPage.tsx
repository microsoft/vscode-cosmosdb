/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Field,
    Input,
    makeStyles,
    mergeClasses,
    MessageBar,
    MessageBarBody,
    shorthands,
    tokens,
} from '@fluentui/react-components';
import { AddRegular, DismissRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useId, useState } from 'react';
import { InfoButton, InlineGuidance, MetricPill, PillRow, SubPanel } from '../components/primitives';
import { getActiveContainer, getAvgDocSizeKb, updateActiveContainer, type DataModel } from '../dataModel';
import { hasReadEvidence, type ReadQuery, type WriteOps } from '../models';
import { nextId } from '../scenarios';
import {
    assessContainerThroughput,
    estimateContainerThroughput,
    estimateReadRu,
    estimateWriteRu,
    getCountErrorMessage,
    getReadEvidenceMessage,
    getThroughputIssueMessage,
    MAX_OPERATIONS_PER_SEC,
    parseCountInput,
    validateCount,
} from '../workloadLimits';

/**
 * Queries tab of a container step. Self-contained editor for the active container's read
 * patterns and write rates. RU estimates are illustrative (prototype), derived from doc size.
 */

const useStyles = makeStyles({
    readGroup: {
        minWidth: 0,
        margin: 0,
        padding: tokens.spacingHorizontalM,
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke1),
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground1,
    },
    readLegend: {
        display: 'inline-flex',
        // An icon-only button has no text baseline, so its bottom edge sits on the legend text's baseline.
        alignItems: 'baseline',
        gap: tokens.spacingHorizontalS,
        paddingInline: tokens.spacingHorizontalXS,
        fontWeight: tokens.fontWeightSemibold,
    },
    readRow: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 32px',
        gap: tokens.spacingHorizontalS,
        alignItems: 'start',
    },
    describeGroup: {
        minWidth: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM} ${tokens.spacingVerticalM}`,
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
        borderRadius: tokens.borderRadiusMedium,
    },
    describeGroupWarning: {
        ...shorthands.borderColor(tokens.colorPaletteDarkOrangeBorder2),
    },
    describeLegend: {
        paddingInline: tokens.spacingHorizontalXS,
        fontWeight: tokens.fontWeightSemibold,
    },
    describeWarning: {
        color: tokens.colorPaletteDarkOrangeForeground1,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
    },
    rateRow: {
        gridColumn: '1 / -1',
        maxWidth: '180px',
    },
    input: {
        minWidth: 0,
        width: '100%',
    },
    hint: {
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
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
    infoText: {
        marginTop: 0,
        marginBottom: tokens.spacingVerticalS,
        ':last-child': { marginBottom: 0 },
    },
});

export interface QueriesPageProps {
    model: DataModel;
    onChange: (next: DataModel) => void;
}

export function QueriesPage({ model, onChange }: QueriesPageProps) {
    const styles = useStyles();
    const readId = useId();
    const describeLabel = l10n.t('Describe the read (at least one)');
    const patternLabel = l10n.t('Description');
    const queryLabel = l10n.t('Query');
    const qpsLabel = l10n.t('Peak QPS');
    const patternHint = l10n.t('What this read retrieves.');
    const queryHint = l10n.t('Full NoSQL SELECT query.');
    const qpsHint = l10n.t('Peak queries/sec, all users.');
    const readInputsInfo = (
        <>
            <p className={styles.infoText}>
                {l10n.t(
                    "Copilot uses each read's description, query, and peak QPS, together with the container's schema, writes, and scale, to recommend a partition key.",
                )}
            </p>
            <p className={styles.infoText}>
                {l10n.t(
                    'Enter a description, a query, or both. A description alone is enough: Copilot infers which properties the read filters on from it and the schema. Copilot does not generate a query from it, so you do not need to write SQL.',
                )}
            </p>
            <p className={styles.infoText}>
                {l10n.t(
                    'If you enter both, the query defines the access pattern and the description adds context. If they disagree, for example on which property is filtered, Copilot asks you to fix the read instead of guessing.',
                )}
            </p>
            <p className={styles.infoText}>{l10n.t('Queries are never run against your account.')}</p>
        </>
    );

    // Queries are per-container: edit the active container's reads and write rates.
    const active = getActiveContainer(model);
    const reads = active?.reads ?? [];
    const writes = active?.writes ?? { insertsPerSec: 0, updatesPerSec: 0, deletesPerSec: 0 };
    const avgDocSizeKb = getAvgDocSizeKb(model);
    const onChangeReads = (next: ReadQuery[]) => onChange(updateActiveContainer(model, (c) => ({ ...c, reads: next })));
    const onChangeWrites = (next: WriteOps) => onChange(updateActiveContainer(model, (c) => ({ ...c, writes: next })));

    // Rejected entries keep the last valid value in the model; errors are keyed per container and field.
    const [rateErrors, setRateErrors] = useState<Record<string, string | undefined>>({});
    const rateErrorKey = (field: string) => `${active?.id ?? ''}:${field}`;
    const rateError = (field: string) => rateErrors[rateErrorKey(field)];
    const applyRate = (field: string, raw: string, apply: (value: number) => void) => {
        const value = parseCountInput(raw);
        const error = validateCount(value, MAX_OPERATIONS_PER_SEC);
        setRateErrors((previous) => ({
            ...previous,
            [rateErrorKey(field)]: error ? getCountErrorMessage(error, MAX_OPERATIONS_PER_SEC) : undefined,
        }));
        if (!error) {
            apply(value);
        }
    };
    const rateValidation = (field: string) => {
        const error = rateError(field);
        return {
            validationState: error ? ('error' as const) : ('none' as const),
            validationMessage: error ? { children: error, role: 'alert' } : undefined,
        };
    };

    const patchRead = (id: string, patch: Partial<ReadQuery>) =>
        onChangeReads(reads.map((r) => (r.id === id ? { ...r, ...patch } : r)));

    const addRead = () => onChangeReads([...reads, { id: nextId('read'), pattern: '', query: '', qps: 0 }]);

    const removeRead = (id: string) => onChangeReads(reads.filter((r) => r.id !== id));

    const totalTps = writes.insertsPerSec + writes.updatesPerSec + writes.deletesPerSec;
    const readRu = estimateReadRu(avgDocSizeKb);
    const writeRu = estimateWriteRu(avgDocSizeKb);
    const totalRu = active ? estimateContainerThroughput(active).totalRuPerSec : 0;
    const throughputIssues = active ? assessContainerThroughput(active) : [];

    return (
        <div className={styles.stack}>
            <SubPanel
                title={'📖 ' + l10n.t('Reads')}
                count={l10n.t('{count} queries', { count: reads.length })}
                subtitle={
                    l10n.t(
                        'Describe each read in words, as a full SQL query, or both. One is enough; if you give both, keep them consistent.',
                    ) +
                    ' ' +
                    l10n.t(
                        'Add its peak queries per second (QPS). The highest-QPS query should drive the partition key.',
                    )
                }
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
                    const missingEvidence = !hasReadEvidence(r);
                    const warningId = `${readId}-${index}-describe-warning`;
                    const qpsField = (
                        <Field
                            label={qpsLabel}
                            className={styles.input}
                            hint={{ children: qpsHint, className: styles.hint, title: qpsHint }}
                            {...rateValidation(`read:${r.id}`)}
                        >
                            <Input
                                name={`reads.${index}.qps`}
                                className={styles.input}
                                aria-label={l10n.t('{label} for read {n}', { label: qpsLabel, n: index + 1 })}
                                type="number"
                                min={0}
                                max={MAX_OPERATIONS_PER_SEC}
                                step={1}
                                value={String(r.qps)}
                                onChange={(_, data) =>
                                    applyRate(`read:${r.id}`, data.value, (qps) => patchRead(r.id, { qps }))
                                }
                            />
                        </Field>
                    );
                    const legendId = `${readId}-${index}-legend`;
                    return (
                        <fieldset key={r.id} className={styles.readGroup} aria-labelledby={legendId}>
                            <legend className={styles.readLegend}>
                                <span id={legendId}>{l10n.t('Read query {n}', { n: index + 1 })}</span>
                                <InfoButton label={l10n.t('How Copilot uses read query {n}', { n: index + 1 })}>
                                    {readInputsInfo}
                                </InfoButton>
                            </legend>
                            <div className={styles.readRow}>
                                <fieldset
                                    className={mergeClasses(
                                        styles.describeGroup,
                                        missingEvidence && styles.describeGroupWarning,
                                    )}
                                    aria-describedby={missingEvidence ? warningId : undefined}
                                >
                                    <legend className={styles.describeLegend}>{describeLabel}</legend>
                                    <Field
                                        label={patternLabel}
                                        className={styles.input}
                                        hint={{ children: patternHint, className: styles.hint, title: patternHint }}
                                    >
                                        <Input
                                            name={`reads.${index}.pattern`}
                                            className={styles.input}
                                            aria-label={l10n.t('{label} for read {n}', {
                                                label: patternLabel,
                                                n: index + 1,
                                            })}
                                            value={r.pattern}
                                            placeholder={l10n.t('e.g., Get all orders for a customer')}
                                            onChange={(_, data) => patchRead(r.id, { pattern: data.value })}
                                        />
                                    </Field>
                                    <Field
                                        label={queryLabel}
                                        className={styles.input}
                                        hint={{ children: queryHint, className: styles.hint, title: queryHint }}
                                    >
                                        <Input
                                            name={`reads.${index}.query`}
                                            className={styles.input}
                                            aria-label={l10n.t('{label} for read {n}', {
                                                label: queryLabel,
                                                n: index + 1,
                                            })}
                                            value={r.query ?? ''}
                                            placeholder="SELECT * FROM c WHERE customerId = @customerId"
                                            onChange={(_, data) => patchRead(r.id, { query: data.value })}
                                        />
                                    </Field>
                                    {missingEvidence ? (
                                        <output id={warningId} className={styles.describeWarning}>
                                            {getReadEvidenceMessage(index + 1)}
                                        </output>
                                    ) : null}
                                </fieldset>
                                <Button
                                    icon={<DismissRegular />}
                                    appearance="subtle"
                                    size="small"
                                    aria-label={l10n.t('Remove read query')}
                                    onClick={() => removeRead(r.id)}
                                />
                                <div className={styles.rateRow}>{qpsField}</div>
                            </div>
                        </fieldset>
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
                    {(
                        [
                            ['insertsPerSec', l10n.t('Inserts / sec')],
                            ['updatesPerSec', l10n.t('Updates / sec')],
                            ['deletesPerSec', l10n.t('Deletes / sec')],
                        ] as const
                    ).map(([field, label]) => (
                        <Field key={field} className={styles.writeCell} label={label} {...rateValidation(field)}>
                            <Input
                                name={`writes.${field}`}
                                className={styles.input}
                                type="number"
                                min={0}
                                max={MAX_OPERATIONS_PER_SEC}
                                step={1}
                                value={String(writes[field])}
                                onChange={(_, data) =>
                                    applyRate(field, data.value, (value) =>
                                        onChangeWrites({ ...writes, [field]: value }),
                                    )
                                }
                            />
                        </Field>
                    ))}
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
                    <MetricPill>
                        {l10n.t('~{ru} RU/s at peak', { ru: Math.round(totalRu).toLocaleString() })}
                    </MetricPill>
                </PillRow>
                {throughputIssues.map((issue) => (
                    <MessageBar
                        key={issue.kind}
                        intent={issue.severity}
                        role={issue.severity === 'error' ? 'alert' : 'status'}
                    >
                        <MessageBarBody>{getThroughputIssueMessage(issue)}</MessageBarBody>
                    </MessageBar>
                ))}
            </SubPanel>
        </div>
    );
}
