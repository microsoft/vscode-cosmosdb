/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Card,
    CardHeader,
    Menu,
    MenuButton,
    MenuItemRadio,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Text,
    Toolbar,
    ToolbarRadioButton,
    Tooltip,
} from '@fluentui/react-components';
import {
    AlertUrgentRegular,
    CheckmarkCircleFilled,
    DismissRegular,
    ErrorCircleFilled,
    LightbulbFilamentRegular,
    OpenRegular,
    WarningFilled,
    WarningRegular,
} from '@fluentui/react-icons';
import { MetricCard } from '@microsoft/vscode-ext-webview-fluentui/components';
import * as l10n from '@vscode/l10n';
import { type JSX, type ReactNode } from 'react';
import { type HealthState } from '../../api/types';
import { findingSourceLabel, type OverviewFinding } from '../AccountOverviewV2/overviewFindingsModel';
import { HEALTH_PRESENTATION, type Tone } from './dashboardModel';

/** A single-choice toggle row, styled like the DocumentDB index list's quick filters (subtle toolbar toggles). */
export function ChoiceGroup<T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: readonly (readonly [T, string])[];
    onChange: (value: T) => void;
}) {
    return (
        <Toolbar
            size="small"
            className="choiceGroup"
            aria-label={label}
            checkedValues={{ choice: [value] }}
            onCheckedValueChange={(_, data) => data.checkedItems[0] && onChange(data.checkedItems[0] as T)}
        >
            {options.map(([option, text]) => (
                <ToolbarRadioButton key={option} name="choice" value={option} appearance="subtle">
                    {text}
                </ToolbarRadioButton>
            ))}
        </Toolbar>
    );
}

/** A state value shown inline in a sentence that opens a menu to change it ("Showing Whole account · Last 24 hours"). */
export function InlineSettingMenu<T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: readonly (readonly [T, string])[];
    onChange: (value: T) => void;
}) {
    const current = options.find(([option]) => option === value)?.[1] ?? value;
    return (
        <Menu
            checkedValues={{ setting: [value] }}
            onCheckedValueChange={(_, data) => data.checkedItems[0] && onChange(data.checkedItems[0] as T)}
        >
            <MenuTrigger disableButtonEnhancement>
                <Tooltip content={label} relationship="description" withArrow>
                    <MenuButton appearance="transparent" size="small" className="inlineSetting">
                        {current}
                    </MenuButton>
                </Tooltip>
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    {options.map(([option, text]) => (
                        <MenuItemRadio key={option} name="setting" value={option}>
                            {text}
                        </MenuItemRadio>
                    ))}
                </MenuList>
            </MenuPopover>
        </Menu>
    );
}

/** A quiet trend line for a metric card: no axes, no tooltip, just the shape of the window. */
export function Sparkline({ values, tone = 'informative' }: { values: readonly number[]; tone?: Tone }) {
    if (values.length < 2) {
        return null;
    }
    const width = 100;
    const height = 28;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const points = values
        .map((value, index) => {
            const x = (index / (values.length - 1)) * width;
            const y = height - 2 - ((value - min) / span) * (height - 4);
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(' ');
    const stroke =
        tone === 'danger'
            ? 'var(--vscode-errorForeground)'
            : tone === 'warning'
              ? 'var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground))'
              : 'var(--vscode-charts-blue, var(--vscode-focusBorder))';
    return (
        <svg
            className="tileSparkline"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            width="100%"
            height={height}
            aria-hidden="true"
        >
            <polyline
                points={points}
                fill="none"
                stroke={stroke}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/** A metric card value with an optional qualifier ("peak 97%") and sparkline beneath it. */
export function TileValue({
    primary,
    secondary,
    tone,
    spark,
    sparkTone,
}: {
    primary: string;
    secondary?: string;
    tone?: Tone;
    spark?: readonly number[];
    sparkTone?: Tone;
}) {
    return (
        <span className="tileValue">
            <span className="tileValueRow">
                <span>{primary}</span>
                {secondary && (
                    <span className="tileSecondary" data-tone={tone}>
                        {secondary}
                    </span>
                )}
            </span>
            {spark && <Sparkline values={spark} tone={sparkTone} />}
        </span>
    );
}

/** One metric card (the shared DocumentDB `MetricCard`), with localized placeholders. */
export function DashboardMetric({
    label,
    value,
    description,
    size,
    appearance,
}: {
    label: string;
    value: ReactNode | null | undefined;
    description?: string;
    size?: 'large' | 'small';
    appearance?: 'filled' | 'subtle';
}) {
    return (
        <MetricCard
            label={label}
            value={value}
            description={description}
            size={size}
            appearance={appearance}
            nullValuePlaceholder={l10n.t('N/A')}
            tooltipPositioning={appearance === 'subtle' ? 'above-start' : 'below'}
        />
    );
}

/** The Query Insights "summary card": a titled card of small, surface-less metric cells. */
export function SummaryCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
    return (
        <Card className="summaryCard">
            <CardHeader
                header={
                    <Text weight="semibold" size={400} className="summaryCardTitle">
                        {title}
                    </Text>
                }
                action={action as JSX.Element | undefined}
            />
            <div className="summaryGrid">{children}</div>
        </Card>
    );
}

/** A figure and a bar scaled against the largest visible row (the index list's Size column). */
export function RelativeBar({
    text,
    value,
    maximum,
    tone,
}: {
    text: string;
    value: number | undefined;
    maximum: number;
    tone?: Tone;
}) {
    const width = value === undefined || maximum <= 0 ? 0 : Math.max(2, Math.round((value / maximum) * 40));
    return (
        <span className="relativeSizeCell">
            <span className="relativeSizeText">{text}</span>
            <span className="relativeSizeTrack" aria-hidden="true">
                {width > 0 && <span className="relativeSizeBar" data-tone={tone} style={{ width }} />}
            </span>
        </span>
    );
}

export function HealthIndicator({ health, throttled }: { health: HealthState | undefined; throttled?: boolean }) {
    if (!health) {
        return <span className="mutedCell">{l10n.t('N/A')}</span>;
    }
    const presentation = HEALTH_PRESENTATION[health];
    const label = throttled
        ? l10n.t('{health} · throttled in the last hour', { health: presentation.label })
        : presentation.label;
    const icon =
        health === 'Critical' ? (
            <ErrorCircleFilled color="var(--vscode-errorForeground)" />
        ) : health === 'Needs Attention' ? (
            <WarningFilled color="var(--vscode-editorWarning-foreground)" />
        ) : (
            <CheckmarkCircleFilled color="var(--vscode-charts-green, var(--vscode-testing-iconPassed))" />
        );
    return (
        <Tooltip content={label} relationship="label" withArrow>
            {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard focus exposes the status tooltip */}
            <span className="nameCell" tabIndex={0}>
                {icon}
                <span className="srOnly">{label}</span>
            </span>
        </Tooltip>
    );
}

export function CountBadge({ count, tone }: { count: number; tone?: 'danger' | 'warning' | 'informative' }) {
    return (
        <Badge
            className="tabCount"
            appearance="tint"
            shape="rounded"
            size="small"
            color={count === 0 ? 'subtle' : (tone ?? 'informative')}
        >
            {count}
        </Badge>
    );
}

function findingTone(finding: OverviewFinding): Tone {
    return finding.priority === 0
        ? 'danger'
        : finding.priority === 1
          ? 'warning'
          : finding.priority === 2
            ? 'warning'
            : 'informative';
}

/**
 * One finding as a Query Insights optimization card: icon, title, severity badge, why it fired, what to do and the
 * (qualitative) payoff. Alerts link to the portal; derived findings can be dismissed for the session.
 */
export function FindingCard({
    finding,
    onOpenUrl,
    onDismiss,
    onInspect,
    inspectLabel,
    compact = false,
}: {
    finding: OverviewFinding;
    onOpenUrl: (url: string) => void;
    onDismiss?: (id: string) => void;
    onInspect?: () => void;
    inspectLabel?: string;
    compact?: boolean;
}) {
    const tone = findingTone(finding);
    const Icon = finding.recommendation
        ? LightbulbFilamentRegular
        : finding.source === 'alert'
          ? AlertUrgentRegular
          : WarningRegular;
    return (
        <Card>
            <div className="findingCard">
                <Icon
                    className="findingIcon"
                    data-tone={finding.recommendation ? undefined : tone}
                    aria-hidden="true"
                />
                <div className="findingBody">
                    <div className="findingTitleRow">
                        <Text weight="semibold" size={compact ? 300 : 400}>
                            {finding.title}
                        </Text>
                        <Badge
                            appearance="tint"
                            shape="rounded"
                            color={tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'informative'}
                        >
                            {finding.severity}
                        </Badge>
                    </div>
                    <span className="findingMeta">
                        {findingSourceLabel(finding.source)} · {finding.summaryScope ?? finding.scope}
                    </span>
                    {!compact && <p className="findingText">{finding.rationale}</p>}
                    {!compact && finding.action && <p className="findingAction">{finding.action}</p>}
                    {(finding.estimatedImpact ?? finding.benefit) && (
                        <span className="findingImpact">{finding.benefit ?? finding.estimatedImpact}</span>
                    )}
                    {(finding.url || onInspect || (onDismiss && finding.source === 'derived')) && (
                        <div className="findingFooter">
                            {onInspect && (
                                <Button size="small" appearance="secondary" onClick={onInspect}>
                                    {inspectLabel ?? l10n.t('Inspect')}
                                </Button>
                            )}
                            {finding.url && (
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    icon={<OpenRegular />}
                                    onClick={() => onOpenUrl(finding.url!)}
                                >
                                    {finding.source === 'alert' ? l10n.t('Open in Azure portal') : l10n.t('Learn more')}
                                </Button>
                            )}
                            {onDismiss && finding.source === 'derived' && (
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    icon={<DismissRegular />}
                                    onClick={() => onDismiss(finding.id)}
                                >
                                    {l10n.t('Dismiss')}
                                </Button>
                            )}
                            {!compact && finding.threshold && (
                                <span className="findingMeta">
                                    {l10n.t('Rule: {threshold}', { threshold: finding.threshold })}
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </Card>
    );
}

/** The success card Query Insights shows when there is nothing to fix. */
export function NothingToFixCard({ title, description }: { title: string; description: string }) {
    return (
        <Card>
            <div className="findingCard">
                <CheckmarkCircleFilled
                    className="findingIcon"
                    color="var(--vscode-charts-green, var(--vscode-testing-iconPassed))"
                    aria-hidden="true"
                />
                <div className="findingBody">
                    <Text weight="semibold" size={400}>
                        {title}
                    </Text>
                    <p className="findingText">{description}</p>
                </div>
            </div>
        </Card>
    );
}
