/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Link,
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
import { useEffect, useId, useMemo, useState } from 'react';
import { getPartitionKeyPaths } from '../../../../dataModeling/deploymentModel';
import { buildExistingDatabaseContainerBicep } from '../../../../panels/migration/helpers/bicepGenerator';
import {
    type CandidateAssessment,
    type ContainerRecommendation,
    type HotPartitionRisk,
    type PartitionKeyRecommendation,
    type PkCandidate,
} from '../../../api/types';
import { MonacoEditor, type MonacoEditorType } from '../../../MonacoEditor';
import { CopilotRecommendation, type RecommendationStatus } from '../components/CopilotRecommendation';
import { InfoBox, SubPanel } from '../components/primitives';

/**
 * Result step. One tab per container, each showing Copilot's partition-key recommendation:
 * scored candidate cards, a hot-partition risk comparison, a query-routing analysis, a
 * document-id strategy, a copyable infrastructure snippet, and relevant absolute rules as the last section.
 * Assessments, scores, and ranking are LLM-driven. Deployment is configured in the following step.
 * While the request is in flight, the {@link CopilotRecommendation} panel shows a waiting note instead.
 */

const CODE_PADDING = 12;
const CODE_BORDER_WIDTH = 1;

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
    guardrails: {
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground2,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        overflowWrap: 'anywhere',
    },
    guardrailsHeading: {
        margin: 0,
        fontSize: tokens.fontSizeBase400,
        fontWeight: tokens.fontWeightSemibold,
    },
    guardrailsList: {
        marginBottom: 0,
        paddingLeft: tokens.spacingHorizontalL,
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
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
        minHeight: '76px',
    },
    cardTitle: {
        minWidth: 0,
        overflowWrap: 'anywhere',
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
    // Subtle caption under a multi-path key, marking it as a hierarchical partition key.
    pkHierarchical: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
        marginTop: tokens.spacingVerticalXXS,
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
    },
    pkHierarchicalLink: {
        fontSize: tokens.fontSizeBase200,
    },
    ring: {
        position: 'relative',
        flexShrink: 0,
        width: '52px',
        height: '52px',
        minWidth: '52px',
        padding: 0,
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
        gap: tokens.spacingVerticalM,
    },
    assessRow: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXS,
        paddingTop: tokens.spacingVerticalM,
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        minWidth: 0,
    },
    assessHeading: {
        display: 'flex',
        gap: tokens.spacingHorizontalS,
        alignItems: 'baseline',
        margin: 0,
        fontSize: tokens.fontSizeBase300,
        fontWeight: tokens.fontWeightSemibold,
    },
    assessIcon: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '18px',
        flexShrink: 0,
        borderRadius: tokens.borderRadiusCircular,
        fontSize: tokens.fontSizeBase100,
        fontWeight: tokens.fontWeightBold,
        color: tokens.colorNeutralForegroundOnBrand,
    },
    iconPass: { backgroundColor: tokens.colorPaletteGreenBackground3 },
    iconFail: { backgroundColor: tokens.colorPaletteRedBackground3 },
    iconInfo: { backgroundColor: tokens.colorBrandBackground },
    iconWarn: { backgroundColor: tokens.colorPaletteDarkOrangeBackground3 },
    assessReason: {
        margin: 0,
        color: tokens.colorNeutralForeground2,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase300,
        overflowWrap: 'anywhere',
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
        minWidth: 0,
    },
    codeHead: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
    },
    codeEditor: {
        marginTop: tokens.spacingVerticalS,
        boxSizing: 'border-box',
        padding: `${CODE_PADDING}px`,
        borderRadius: tokens.borderRadiusMedium,
        border: `${CODE_BORDER_WIDTH}px solid ${tokens.colorNeutralStroke2}`,
        overflow: 'hidden',
    },
    copiedIcon: {
        color: tokens.colorBrandForeground1,
    },
});

type CodeTab = 'bicep' | 'terraform' | 'sdk';

const CODE_LANGUAGES: Record<CodeTab, string> = { bicep: 'bicep', terraform: 'hcl', sdk: 'csharp' };
const CODE_LINE_HEIGHT = 20;
const CODE_SCROLLBAR_SIZE = 12;
const CODE_EDITOR_OPTIONS: MonacoEditorType.editor.IStandaloneEditorConstructionOptions = {
    readOnly: true,
    domReadOnly: true,
    ariaLabel: l10n.t('Container creation code sample'),
    tabFocusMode: true,
    minimap: { enabled: false },
    lineNumbers: 'off',
    glyphMargin: false,
    folding: false,
    stickyScroll: { enabled: false },
    lineDecorationsWidth: 0,
    overviewRulerLanes: 0,
    overviewRulerBorder: false,
    renderLineHighlight: 'none',
    scrollBeyondLastLine: false,
    wordWrap: 'off',
    fontSize: 13,
    lineHeight: CODE_LINE_HEIGHT,
    padding: { top: 0, bottom: 0 },
    scrollbar: { horizontalScrollbarSize: CODE_SCROLLBAR_SIZE, alwaysConsumeMouseWheel: false },
};

function buildCode(tab: CodeTab, entity: string, partitionKey: string): string {
    const paths = getPartitionKeyPaths(partitionKey);
    const quotedEntity = JSON.stringify(entity);
    const quotedPaths = paths.map((path) => JSON.stringify(path));
    const terraformString = (value: string) =>
        JSON.stringify(value)
            .replace(/\$\{/g, () => '$${')
            .replace(/%\{/g, '%%{');
    switch (tab) {
        case 'bicep':
            return buildExistingDatabaseContainerBicep({
                name: entity,
                partitionKeys: paths.map((path) => ({ path })),
            });
        case 'terraform':
            return [
                `resource "azurerm_cosmosdb_sql_container" "container" {`,
                `  name                  = ${terraformString(entity)}`,
                `  resource_group_name   = var.resource_group_name`,
                `  account_name          = var.account_name`,
                `  database_name         = var.database_name`,
                `  partition_key_paths   = [${paths.map(terraformString).join(', ')}]`,
                `  partition_key_kind    = "${paths.length > 1 ? 'MultiHash' : 'Hash'}"`,
                `  partition_key_version = 2`,
                `}`,
            ].join('\n');
        case 'sdk':
            return [
                `var props = new ContainerProperties(`,
                `    id: ${quotedEntity},`,
                paths.length > 1
                    ? `    partitionKeyPaths: new[] { ${quotedPaths.join(', ')} });`
                    : `    partitionKeyPath: ${quotedPaths[0]});`,
                `props.PartitionKeyDefinitionVersion = PartitionKeyDefinitionVersion.V2;`,
                `await database.CreateContainerIfNotExistsAsync(props);`,
            ].join('\n');
    }
}

const ASSESS_GLYPH: Record<CandidateAssessment['status'], string> = { pass: '✓', fail: '✗', info: 'i', warn: '!' };

/** Azure Cosmos DB hierarchical (multi-level) partition keys documentation. */
const HIERARCHICAL_PARTITION_KEY_DOCS_URL = 'https://learn.microsoft.com/azure/cosmos-db/hierarchical-partition-keys';

/**
 * Renders a partition key for display. A hierarchical key's comma-separated paths are joined
 * into a single slash path (e.g. `/tenantId, /id` → `/tenantId/id`, and `/a, /b, /c` →
 * `/a/b/c`); a single-path key is returned unchanged.
 */
function formatPartitionKeyForDisplay(paths: string[], partitionKey: string): string {
    if (paths.length <= 1) {
        return partitionKey;
    }
    return paths.map((path) => `/${path.replace(/^\/+/, '').replace(/\/+$/, '')}`).join('');
}

const formatScore = (value: number) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.ceil(value));

function ScoreRing({ candidate, context, color }: { candidate: PkCandidate; context: string; color: string }) {
    const styles = useStyles();
    const score = Math.max(0, Math.min(100, candidate.score));
    const scoreText = formatScore(score);
    return (
        <div
            className={styles.ring}
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Composite score graphic, not an image file.
            role="img"
            aria-label={l10n.t('Score {score} out of 100 for {context}', { score: scoreText, context })}
        >
            <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
                <circle cx="26" cy="26" r="22" fill="none" stroke={tokens.colorNeutralStroke2} strokeWidth="3" />
                <circle
                    cx="26"
                    cy="26"
                    r="22"
                    fill="none"
                    stroke={color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={`${(score / 100) * 138.23} 138.23`}
                    transform="rotate(-90 26 26)"
                />
            </svg>
            <span className={styles.ringVal} style={{ color }} aria-hidden="true">
                {scoreText}
            </span>
        </div>
    );
}

function CandidateCard({ candidate, entity }: { candidate: PkCandidate; entity: string }) {
    const styles = useStyles();
    const assessmentId = useId();

    // Two or more paths means Cosmos DB treats this as a hierarchical partition key.
    const partitionKeyPaths = getPartitionKeyPaths(candidate.partitionKey);
    const isHierarchical = partitionKeyPaths.length >= 2;
    const displayKey = formatPartitionKeyForDisplay(partitionKeyPaths, candidate.partitionKey);

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
    const statusText: Record<CandidateAssessment['status'], string> = {
        pass: l10n.t('Pass'),
        fail: l10n.t('Fail'),
        info: l10n.t('Information'),
        warn: l10n.t('Warning'),
    };

    return (
        <div className={mergeClasses(styles.card, cardTone[candidate.verdict])}>
            <div className={styles.cardHead}>
                <div className={styles.cardTitle}>
                    <Text className={mergeClasses(styles.badge, badgeTone[candidate.verdict])}>
                        {badgeText[candidate.verdict]}
                    </Text>
                    <Text className={styles.pk}>{displayKey}</Text>
                    {isHierarchical ? (
                        <div className={styles.pkHierarchical}>
                            <Text>{l10n.t('Hierarchical partition key')}</Text>
                            <Link
                                className={styles.pkHierarchicalLink}
                                href={HIERARCHICAL_PARTITION_KEY_DOCS_URL}
                                target="_blank"
                                aria-label={l10n.t('Learn more about hierarchical partition keys')}
                            >
                                {l10n.t('Learn more')}
                            </Link>
                        </div>
                    ) : null}
                </div>
                <ScoreRing
                    candidate={candidate}
                    context={`${entity} ${displayKey}`}
                    color={ringStroke[candidate.verdict]}
                />
            </div>
            <div className={styles.assessList}>
                {candidate.assessments.map((a, i) => (
                    <section key={i} className={styles.assessRow} aria-labelledby={`${assessmentId}-${i}`}>
                        <h3 className={styles.assessHeading} id={`${assessmentId}-${i}`}>
                            <span
                                className={mergeClasses(styles.assessIcon, iconTone[a.status])}
                                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Text glyph, not an image file.
                                role="img"
                                aria-label={statusText[a.status]}
                            >
                                <span aria-hidden="true">{ASSESS_GLYPH[a.status]}</span>
                            </span>
                            {a.label}
                        </h3>
                        <p className={styles.assessReason}>{a.detail}</p>
                    </section>
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
    const guardrailsId = useId();
    const [codeTab, setCodeTab] = useState<CodeTab>('bicep');
    const [copied, setCopied] = useState(false);

    const code = useMemo(
        () => buildCode(codeTab, container.entity, container.partitionKey),
        [codeTab, container.entity, container.partitionKey],
    );
    // Include the frame's persistent inset and border so short snippets do not lose their final line.
    const codeEditorHeight = Math.min(
        400,
        code.split('\n').length * CODE_LINE_HEIGHT + 2 * (CODE_PADDING + CODE_BORDER_WIDTH) + CODE_SCROLLBAR_SIZE,
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
                        <CandidateCard key={i} candidate={c} entity={container.entity} />
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
                <div className={styles.codeEditor} style={{ height: codeEditorHeight }}>
                    <MonacoEditor language={CODE_LANGUAGES[codeTab]} value={code} options={CODE_EDITOR_OPTIONS} />
                </div>
            </div>
            {container.guardrails?.length ? (
                <section className={styles.guardrails} aria-labelledby={guardrailsId}>
                    <h2 id={guardrailsId} className={styles.guardrailsHeading}>
                        {l10n.t('Absolute rules (guardrails)')}
                    </h2>
                    <ul className={styles.guardrailsList}>
                        {container.guardrails.map(({ rule, detail }, index) => (
                            <li key={index}>
                                <Text weight="semibold" block>
                                    {rule}
                                </Text>
                                <Text>{detail}</Text>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
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
                            <Text as="span">
                                {l10n.t('Container:')}{' '}
                                <Text as="span" font="monospace">
                                    {c.entity}
                                </Text>
                            </Text>
                        </Tab>
                    ))}
                </TabList>
            ) : null}

            <ContainerResultView key={active.entity} container={active} />
        </div>
    );
}
