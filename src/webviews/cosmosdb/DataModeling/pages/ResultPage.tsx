/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, mergeClasses, Tab, TabList, Text, tokens } from '@fluentui/react-components';
import { CopyRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useMemo, useState } from 'react';
import { FieldGroup, PageHeader, SubPanel } from '../components/primitives';
import { WeightSliders } from '../components/WeightSliders';
import { type ContainerModel, type ScoringWeights } from '../models';
import {
    type AssessmentIcon,
    buildContainerResult,
    type CandidateType,
    rankCandidates,
    type RiskLevel,
} from '../results';

/**
 * Step 6 — Result. Ranks partition-key candidates for the active container by a
 * weighted best-practice score, shows a hot-partition risk comparison, and lets
 * the user re-tune the scoring weights inline (the ranking updates live). All
 * scoring is illustrative prototype data.
 */

const useStyles = makeStyles({
    stack: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalL,
    },
    containerBar: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: tokens.spacingHorizontalS,
    },
    // Ranked candidate cards adapt from multi-column to single column when narrow.
    cards: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: tokens.spacingHorizontalM,
    },
    card: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
        padding: tokens.spacingHorizontalL,
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderLeftWidth: '3px',
        backgroundColor: tokens.colorNeutralBackground1,
    },
    cardRec: { borderLeftColor: tokens.colorPaletteGreenBorder2 },
    cardAlt: { borderLeftColor: tokens.colorBrandStroke1 },
    cardAvoid: { borderLeftColor: tokens.colorPaletteRedBorder2 },
    cardHead: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalM,
    },
    badge: {
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
    },
    pk: {
        display: 'block',
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase500,
        fontWeight: tokens.fontWeightSemibold,
    },
    ring: {
        position: 'relative',
        flexShrink: 0,
        width: '44px',
        height: '44px',
    },
    ringVal: {
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightBold,
    },
    assessList: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXS,
    },
    assessRow: {
        display: 'grid',
        gridTemplateColumns: '18px auto 1fr',
        gap: tokens.spacingHorizontalS,
        alignItems: 'baseline',
    },
    assessIcon: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '18px',
        borderRadius: tokens.borderRadiusCircular,
        fontSize: tokens.fontSizeBase100,
        fontWeight: tokens.fontWeightBold,
        color: tokens.colorNeutralForegroundOnBrand,
    },
    iconPass: { backgroundColor: tokens.colorPaletteGreenBackground3 },
    iconFail: { backgroundColor: tokens.colorPaletteRedBackground3 },
    iconInfo: { backgroundColor: tokens.colorBrandBackground },
    iconWarn: { backgroundColor: tokens.colorPaletteDarkOrangeBackground3 },
    assessRule: {
        fontWeight: tokens.fontWeightSemibold,
        whiteSpace: 'nowrap',
    },
    assessReason: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
    rankList: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
    },
    rankRow: {
        display: 'grid',
        gridTemplateColumns: 'minmax(90px, 160px) 1fr auto',
        gap: tokens.spacingHorizontalM,
        alignItems: 'center',
    },
    rankPk: {
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase200,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    rankTrack: {
        height: '8px',
        borderRadius: tokens.borderRadiusCircular,
        backgroundColor: tokens.colorNeutralBackground4,
        overflow: 'hidden',
    },
    rankFill: {
        height: '100%',
        borderRadius: tokens.borderRadiusCircular,
    },
    fillLow: { backgroundColor: tokens.colorPaletteGreenForeground1 },
    fillMedium: { backgroundColor: tokens.colorPaletteDarkOrangeForeground1 },
    fillHigh: { backgroundColor: tokens.colorPaletteRedForeground1 },
    rankLabel: {
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
    },
    labelLow: { color: tokens.colorPaletteGreenForeground1 },
    labelMedium: { color: tokens.colorPaletteDarkOrangeForeground1 },
    labelHigh: { color: tokens.colorPaletteRedForeground1 },
    codeWrap: {
        position: 'relative',
    },
    codeHead: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
    },
    pre: {
        margin: 0,
        marginTop: tokens.spacingVerticalS,
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground3,
        overflowX: 'auto',
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase200,
        whiteSpace: 'pre',
    },
    actions: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
    },
    spacer: {
        marginLeft: 'auto',
    },
});

type CodeTab = 'bicep' | 'terraform' | 'sdk';

function buildCode(tab: CodeTab, entity: string, partitionKey: string): string {
    switch (tab) {
        case 'bicep':
            return [
                `resource container 'Microsoft.DocumentDB/.../containers@2024-05-15' = {`,
                `  name: '${entity}'`,
                `  properties: {`,
                `    resource: {`,
                `      id: '${entity}'`,
                `      partitionKey: {`,
                `        paths: [ '${partitionKey}' ]`,
                `        kind: 'Hash'`,
                `      }`,
                `    }`,
                `  }`,
                `}`,
            ].join('\n');
        case 'terraform':
            return [
                `resource "azurerm_cosmosdb_sql_container" "${entity.toLowerCase()}" {`,
                `  name                = "${entity}"`,
                `  partition_key_paths = ["${partitionKey}"]`,
                `  partition_key_version = 2`,
                `}`,
            ].join('\n');
        case 'sdk':
            return [
                `var props = new ContainerProperties(`,
                `    id: "${entity}",`,
                `    partitionKeyPath: "${partitionKey}");`,
                `await database.CreateContainerIfNotExistsAsync(props);`,
            ].join('\n');
    }
}

const ASSESS_GLYPH: Record<AssessmentIcon, string> = { pass: '✓', fail: '✗', info: 'i', warn: '!' };

export interface ResultPageProps {
    containers: ContainerModel[];
    activeContainerId?: string;
    weights: ScoringWeights;
    onChangeWeights: (weights: ScoringWeights) => void;
    onSelectContainer: (id: string) => void;
    onRestart: () => void;
}

export function ResultPage({
    containers,
    activeContainerId,
    weights,
    onChangeWeights,
    onSelectContainer,
    onRestart,
}: ResultPageProps) {
    const styles = useStyles();
    const [codeTab, setCodeTab] = useState<CodeTab>('bicep');
    const active = containers.find((c) => c.id === activeContainerId) ?? containers[0];

    // Rebuild the base result only when the active container changes; re-rank on
    // every weight change so the sliders update the ordering and scores live.
    const result = useMemo(() => (active ? buildContainerResult(active) : undefined), [active]);
    const ranked = useMemo(() => (result ? rankCandidates(result.candidates, weights) : []), [result, weights]);

    const topPk = ranked.find((c) => c.type !== 'avoid')?.pk ?? active?.partitionKey ?? '/id';
    const code = useMemo(() => (active ? buildCode(codeTab, active.entity, topPk) : ''), [codeTab, active, topPk]);

    const copy = () => void navigator.clipboard?.writeText(code);

    if (!active || !result) {
        return null;
    }

    const cardTone: Record<CandidateType, string> = {
        rec: styles.cardRec,
        alt: styles.cardAlt,
        avoid: styles.cardAvoid,
    };
    const iconTone: Record<AssessmentIcon, string> = {
        pass: styles.iconPass,
        fail: styles.iconFail,
        info: styles.iconInfo,
        warn: styles.iconWarn,
    };
    const fillTone: Record<RiskLevel, string> = {
        low: styles.fillLow,
        medium: styles.fillMedium,
        high: styles.fillHigh,
    };
    const labelTone: Record<RiskLevel, string> = {
        low: styles.labelLow,
        medium: styles.labelMedium,
        high: styles.labelHigh,
    };
    const riskLabel: Record<RiskLevel, string> = {
        low: l10n.t('Low'),
        medium: l10n.t('Medium'),
        high: l10n.t('High'),
    };
    const ringStroke: Record<CandidateType, string> = {
        rec: tokens.colorPaletteGreenForeground1,
        alt: tokens.colorBrandForeground1,
        avoid: tokens.colorPaletteRedForeground1,
    };

    return (
        <div className={styles.stack}>
            <PageHeader title={l10n.t('Partition key recommendation')} description={result.summary} />

            {containers.length > 1 ? (
                <div className={styles.containerBar}>
                    {containers.map((c) => (
                        <Button
                            key={c.id}
                            appearance={c.id === active.id ? 'primary' : 'secondary'}
                            size="small"
                            onClick={() => onSelectContainer(c.id)}
                        >
                            {c.entity}
                        </Button>
                    ))}
                </div>
            ) : null}

            <div className={styles.cards}>
                {ranked.map((c) => (
                    <div key={c.id} className={mergeClasses(styles.card, cardTone[c.type])}>
                        <div className={styles.cardHead}>
                            <div>
                                <Text className={styles.badge}>{c.badge}</Text>
                                <Text className={styles.pk}>{c.pk}</Text>
                            </div>
                            <div className={styles.ring} aria-hidden="true">
                                <svg width="44" height="44" viewBox="0 0 44 44">
                                    <circle
                                        cx="22"
                                        cy="22"
                                        r="18"
                                        fill="none"
                                        stroke={tokens.colorNeutralStroke2}
                                        strokeWidth="4"
                                    />
                                    <circle
                                        cx="22"
                                        cy="22"
                                        r="18"
                                        fill="none"
                                        stroke={ringStroke[c.type]}
                                        strokeWidth="4"
                                        strokeLinecap="round"
                                        strokeDasharray={`${(c.score / 100) * 113} 113`}
                                        transform="rotate(-90 22 22)"
                                    />
                                </svg>
                                <span className={styles.ringVal} style={{ color: ringStroke[c.type] }}>
                                    {c.score}
                                </span>
                            </div>
                        </div>
                        <div className={styles.assessList}>
                            {c.rows.map((r, i) => (
                                <div key={i} className={styles.assessRow}>
                                    <span className={mergeClasses(styles.assessIcon, iconTone[r.icon])}>
                                        {ASSESS_GLYPH[r.icon]}
                                    </span>
                                    <span className={styles.assessRule}>{r.rule}</span>
                                    <span className={styles.assessReason}>{r.reason}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <SubPanel
                title={l10n.t('🔥 Hot-partition risk — candidates compared')}
                subtitle={l10n.t('Measured from sampled logical-partition skew. Lower is better.')}
            >
                <div className={styles.rankList}>
                    {result.ranking.map((r) => (
                        <div key={r.pk} className={styles.rankRow}>
                            <span className={styles.rankPk}>{r.pk}</span>
                            <div className={styles.rankTrack}>
                                <div
                                    className={mergeClasses(styles.rankFill, fillTone[r.risk])}
                                    style={{ width: `${r.pct}%` }}
                                />
                            </div>
                            <span className={mergeClasses(styles.rankLabel, labelTone[r.risk])}>
                                {riskLabel[r.risk]}
                            </span>
                        </div>
                    ))}
                </div>
            </SubPanel>

            <FieldGroup
                label={l10n.t('Scoring priorities')}
                hint={l10n.t('Slide toward what matters most for your workload — the ranking re-scores instantly.')}
            >
                <WeightSliders weights={weights} onChange={onChangeWeights} />
            </FieldGroup>

            <div className={styles.codeWrap}>
                <div className={styles.codeHead}>
                    <TabList selectedValue={codeTab} onTabSelect={(_, data) => setCodeTab(data.value as CodeTab)}>
                        <Tab value="bicep">Bicep</Tab>
                        <Tab value="terraform">Terraform</Tab>
                        <Tab value="sdk">{l10n.t('SDK (C#)')}</Tab>
                    </TabList>
                    <Button icon={<CopyRegular />} appearance="subtle" size="small" onClick={copy}>
                        {l10n.t('Copy')}
                    </Button>
                </div>
                <pre className={styles.pre}>{code}</pre>
            </div>

            <div className={styles.actions}>
                <Button appearance="primary">{l10n.t('Apply to Container')}</Button>
                <Button appearance="secondary" onClick={copy}>
                    {l10n.t('Copy Config')}
                </Button>
                <Button appearance="secondary">{l10n.t('Open in Copilot Chat')}</Button>
                <Button appearance="subtle" className={styles.spacer} onClick={onRestart}>
                    {l10n.t('Start Over')}
                </Button>
            </div>
        </div>
    );
}
