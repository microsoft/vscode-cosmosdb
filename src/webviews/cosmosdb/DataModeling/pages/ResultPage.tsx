/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    makeStyles,
    mergeClasses,
    Tab,
    TabList,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
    tokens,
} from '@fluentui/react-components';
import { CheckmarkRegular, CopyRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useEffect, useMemo, useState } from 'react';
import {
    type CandidateAssessment,
    type ContainerRecommendation,
    type HotPartitionRisk,
    type PartitionKeyRecommendation,
    type PkCandidate,
} from '../../../api/types';
import { CopilotRecommendation, type RecommendationStatus } from '../components/CopilotRecommendation';
import { InfoBox, SubPanel } from '../components/primitives';

/**
 * Result step. One tab per container, each showing Copilot's partition-key recommendation:
 * scored candidate cards, a hot-partition risk comparison, a query-routing analysis, a
 * document-id strategy, and a copyable infrastructure snippet with Apply / Copy actions. All
 * content is LLM-driven — while the request is in flight the {@link CopilotRecommendation} panel
 * shows a waiting note instead.
 */

const useStyles = makeStyles({
    stack: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalL,
    },
    tabList: {
        flexWrap: 'wrap',
    },
    summary: {
        color: tokens.colorNeutralForeground2,
    },
    // Responsive grid: compact panels sit side by side on wide surfaces and stack when narrow.
    twoCol: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: tokens.spacingHorizontalM,
        alignItems: 'start',
    },
    tableWrap: {
        overflowX: 'auto',
    },
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
        textTransform: 'uppercase',
    },
    badgeRec: { color: tokens.colorPaletteGreenForeground1 },
    badgeAlt: { color: tokens.colorBrandForeground1 },
    badgeAvoid: { color: tokens.colorPaletteRedForeground1 },
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
    routeSingle: { color: tokens.colorPaletteGreenForeground1, fontWeight: tokens.fontWeightSemibold },
    routeCross: { color: tokens.colorPaletteRedForeground1, fontWeight: tokens.fontWeightSemibold },
    analysis: {
        marginTop: tokens.spacingVerticalM,
        color: tokens.colorNeutralForeground2,
        whiteSpace: 'pre-wrap',
    },
    strategyTag: {
        marginBottom: tokens.spacingVerticalS,
    },
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
        marginTop: tokens.spacingVerticalM,
    },
    copiedIcon: {
        color: tokens.colorBrandForeground1,
    },
});

type CodeTab = 'bicep' | 'terraform' | 'sdk';

function buildCode(tab: CodeTab, entity: string, partitionKey: string): string {
    const safeEntity = entity || 'Container';
    const pk = partitionKey || '/id';
    switch (tab) {
        case 'bicep':
            return [
                `resource container 'Microsoft.DocumentDB/.../containers@2024-05-15' = {`,
                `  name: '${safeEntity}'`,
                `  properties: {`,
                `    resource: {`,
                `      id: '${safeEntity}'`,
                `      partitionKey: {`,
                `        paths: [ '${pk}' ]`,
                `        kind: 'Hash'`,
                `      }`,
                `    }`,
                `  }`,
                `}`,
            ].join('\n');
        case 'terraform':
            return [
                `resource "azurerm_cosmosdb_sql_container" "${safeEntity.toLowerCase()}" {`,
                `  name                  = "${safeEntity}"`,
                `  partition_key_paths   = ["${pk}"]`,
                `  partition_key_version = 2`,
                `}`,
            ].join('\n');
        case 'sdk':
            return [
                `var props = new ContainerProperties(`,
                `    id: "${safeEntity}",`,
                `    partitionKeyPath: "${pk}");`,
                `await database.CreateContainerIfNotExistsAsync(props);`,
            ].join('\n');
    }
}

const ASSESS_GLYPH: Record<CandidateAssessment['status'], string> = { pass: '✓', fail: '✗', info: 'i', warn: '!' };

function CandidateCard({ candidate }: { candidate: PkCandidate }) {
    const styles = useStyles();

    const cardTone: Record<PkCandidate['verdict'], string> = {
        recommended: styles.cardRec,
        alternative: styles.cardAlt,
        avoid: styles.cardAvoid,
    };
    const badgeTone: Record<PkCandidate['verdict'], string> = {
        recommended: styles.badgeRec,
        alternative: styles.badgeAlt,
        avoid: styles.badgeAvoid,
    };
    const badgeText: Record<PkCandidate['verdict'], string> = {
        recommended: l10n.t('Recommended'),
        alternative: l10n.t('Alternative'),
        avoid: l10n.t('Avoid'),
    };
    const ringStroke: Record<PkCandidate['verdict'], string> = {
        recommended: tokens.colorPaletteGreenForeground1,
        alternative: tokens.colorBrandForeground1,
        avoid: tokens.colorPaletteRedForeground1,
    };
    const iconTone: Record<CandidateAssessment['status'], string> = {
        pass: styles.iconPass,
        fail: styles.iconFail,
        info: styles.iconInfo,
        warn: styles.iconWarn,
    };

    const score = Math.max(0, Math.min(100, Math.round(candidate.score)));

    return (
        <div className={mergeClasses(styles.card, cardTone[candidate.verdict])}>
            <div className={styles.cardHead}>
                <div>
                    <Text className={mergeClasses(styles.badge, badgeTone[candidate.verdict])}>
                        {badgeText[candidate.verdict]}
                    </Text>
                    <Text className={styles.pk}>{candidate.partitionKey}</Text>
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
                            stroke={ringStroke[candidate.verdict]}
                            strokeWidth="4"
                            strokeLinecap="round"
                            strokeDasharray={`${(score / 100) * 113} 113`}
                            transform="rotate(-90 22 22)"
                        />
                    </svg>
                    <span className={styles.ringVal} style={{ color: ringStroke[candidate.verdict] }}>
                        {score}
                    </span>
                </div>
            </div>
            <div className={styles.assessList}>
                {candidate.assessments.map((a, i) => (
                    <div key={i} className={styles.assessRow}>
                        <span className={mergeClasses(styles.assessIcon, iconTone[a.status])}>
                            {ASSESS_GLYPH[a.status]}
                        </span>
                        <span className={styles.assessRule}>{a.label}</span>
                        <span className={styles.assessReason}>{a.detail}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function riskBand(risk: HotPartitionRisk['risk']): { fill: string; label: string; text: string } {
    // "severe" shares the high (red) visuals but keeps its own label.
    const styleName = risk === 'severe' ? 'high' : risk;
    return { fill: styleName, label: styleName, text: risk };
}

function ContainerResultView({ container }: { container: ContainerRecommendation }) {
    const styles = useStyles();
    const [codeTab, setCodeTab] = useState<CodeTab>('bicep');
    const [copied, setCopied] = useState(false);

    const code = useMemo(
        () => buildCode(codeTab, container.entity, container.partitionKey),
        [codeTab, container.entity, container.partitionKey],
    );

    // Reset the "Copied" affordance shortly after a copy; clean up on unmount / tab switch.
    useEffect(() => {
        if (!copied) {
            return;
        }
        const timer = setTimeout(() => setCopied(false), 1500);
        return () => clearTimeout(timer);
    }, [copied]);

    const copy = () => {
        void navigator.clipboard?.writeText(code);
        setCopied(true);
    };

    const fillTone: Record<'low' | 'medium' | 'high', string> = {
        low: styles.fillLow,
        medium: styles.fillMedium,
        high: styles.fillHigh,
    };
    const labelTone: Record<'low' | 'medium' | 'high', string> = {
        low: styles.labelLow,
        medium: styles.labelMedium,
        high: styles.labelHigh,
    };
    const riskLabelText: Record<HotPartitionRisk['risk'], string> = {
        low: l10n.t('Low'),
        medium: l10n.t('Medium'),
        high: l10n.t('High'),
        severe: l10n.t('Severe'),
    };

    return (
        <div className={styles.stack}>
            {container.rationale ? <Text className={styles.summary}>{container.rationale}</Text> : null}

            {container.candidates && container.candidates.length > 0 ? (
                <div className={styles.cards}>
                    {container.candidates.map((c, i) => (
                        <CandidateCard key={i} candidate={c} />
                    ))}
                </div>
            ) : null}

            <div className={styles.twoCol}>
                {container.hotPartitionRisk && container.hotPartitionRisk.length > 0 ? (
                    <SubPanel
                        title={l10n.t('🔥 Hot-partition risk — candidates compared')}
                        subtitle={l10n.t('Measured from sampled logical-partition skew. Lower is better.')}
                    >
                        <div className={styles.rankList}>
                            {container.hotPartitionRisk.map((r, i) => {
                                const band = riskBand(r.risk);
                                const pct = Math.max(0, Math.min(100, Math.round(r.pct)));
                                return (
                                    <div key={i} className={styles.rankRow}>
                                        <span className={styles.rankPk}>{r.partitionKey}</span>
                                        <div className={styles.rankTrack}>
                                            <div
                                                className={mergeClasses(
                                                    styles.rankFill,
                                                    fillTone[band.fill as 'low' | 'medium' | 'high'],
                                                )}
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                        <span
                                            className={mergeClasses(
                                                styles.rankLabel,
                                                labelTone[band.label as 'low' | 'medium' | 'high'],
                                            )}
                                        >
                                            {riskLabelText[r.risk]}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </SubPanel>
                ) : null}

                {container.documentIdStrategy ? (
                    <SubPanel title={l10n.t('🆔 Document id strategy')}>
                        <div className={styles.strategyTag}>
                            <Badge appearance="tint" color="informative">
                                {container.documentIdStrategy.tag}
                            </Badge>
                        </div>
                        <InfoBox>{container.documentIdStrategy.recommendation}</InfoBox>
                    </SubPanel>
                ) : null}
            </div>

            {container.queryRouting ? (
                <SubPanel title={l10n.t('🧭 Query routing')} subtitle={container.queryRouting.headline}>
                    <div className={styles.tableWrap}>
                        <Table size="small" aria-label={l10n.t('Query routing')}>
                            <TableHeader>
                                <TableRow>
                                    <TableHeaderCell>{l10n.t('Read pattern')}</TableHeaderCell>
                                    <TableHeaderCell>{l10n.t('Filters on')}</TableHeaderCell>
                                    <TableHeaderCell>{l10n.t('QPS')}</TableHeaderCell>
                                    <TableHeaderCell>{l10n.t('Routing')}</TableHeaderCell>
                                    <TableHeaderCell>{l10n.t('Est. cost')}</TableHeaderCell>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {container.queryRouting.routes.map((route, i) => (
                                    <TableRow key={i}>
                                        <TableCell>{route.pattern}</TableCell>
                                        <TableCell>{route.filters}</TableCell>
                                        <TableCell>{route.qps}</TableCell>
                                        <TableCell>
                                            <span
                                                className={
                                                    route.routing === 'single' ? styles.routeSingle : styles.routeCross
                                                }
                                            >
                                                {route.routing === 'single'
                                                    ? l10n.t('Single-partition')
                                                    : l10n.t('Cross-partition')}
                                            </span>
                                        </TableCell>
                                        <TableCell>{route.estCost}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    {container.queryRouting.analysis ? (
                        <Text className={styles.analysis} as="p">
                            {container.queryRouting.analysis}
                        </Text>
                    ) : null}
                </SubPanel>
            ) : null}

            <div className={styles.codeWrap}>
                <div className={styles.codeHead}>
                    <TabList selectedValue={codeTab} onTabSelect={(_, data) => setCodeTab(data.value as CodeTab)}>
                        <Tab value="bicep">Bicep</Tab>
                        <Tab value="terraform">Terraform</Tab>
                        <Tab value="sdk">{l10n.t('SDK (C#)')}</Tab>
                    </TabList>
                    <Button
                        icon={copied ? <CheckmarkRegular className={styles.copiedIcon} /> : <CopyRegular />}
                        appearance="subtle"
                        size="small"
                        onClick={copy}
                    >
                        {copied ? l10n.t('Copied') : l10n.t('Copy')}
                    </Button>
                </div>
                <pre className={styles.pre}>{code}</pre>
                <div className={styles.actions}>
                    <Button appearance="primary">{l10n.t('Apply to Container')}</Button>
                </div>
            </div>
        </div>
    );
}

export interface ResultPageProps {
    recommendationStatus: RecommendationStatus;
    recommendation?: PartitionKeyRecommendation;
    recommendationError?: string;
    onRetryRecommendation: () => void;
}

export function ResultPage({
    recommendationStatus,
    recommendation,
    recommendationError,
    onRetryRecommendation,
}: ResultPageProps) {
    const styles = useStyles();
    const containers = recommendation?.containers ?? [];
    const [activeEntity, setActiveEntity] = useState<string>();

    const active = containers.find((c) => c.entity === activeEntity) ?? containers[0];

    // A `received` status with no usable container means the tool delivered an
    // empty/invalid recommendation. Surface it as a retryable error instead of a
    // blank page so the state is never silently stuck.
    const receivedButEmpty = recommendationStatus === 'received' && !active;

    if (recommendationStatus !== 'received' || !recommendation || !active) {
        return (
            <div className={styles.stack}>
                <CopilotRecommendation
                    status={receivedButEmpty ? 'error' : recommendationStatus}
                    error={
                        receivedButEmpty
                            ? l10n.t('Copilot returned an empty recommendation. Try requesting it again.')
                            : recommendationError
                    }
                    onRetry={onRetryRecommendation}
                />
            </div>
        );
    }

    return (
        <div className={styles.stack}>
            {recommendation.summary ? <Text className={styles.summary}>{recommendation.summary}</Text> : null}

            {containers.length > 1 ? (
                <TabList
                    className={styles.tabList}
                    selectedValue={active.entity}
                    onTabSelect={(_, data) => setActiveEntity(data.value as string)}
                >
                    {containers.map((c) => (
                        <Tab key={c.entity} value={c.entity}>
                            <Text as="span" font="monospace">
                                {l10n.t('container:')} {c.entity}
                            </Text>
                        </Tab>
                    ))}
                </TabList>
            ) : null}

            <ContainerResultView key={active.entity} container={active} />
        </div>
    );
}
