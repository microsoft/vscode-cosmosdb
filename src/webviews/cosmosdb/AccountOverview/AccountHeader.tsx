/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Badge,
    type BadgeProps,
    Button,
    Dropdown,
    makeStyles,
    mergeClasses,
    Option,
    Spinner,
    Text,
    tokens,
    Tooltip,
    typographyStyles,
} from '@fluentui/react-components';
import { ArrowClockwise16Regular, Braces16Regular, Money16Regular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useId, useMemo, useState } from 'react';
import {
    type AccountActionInput,
    type HealthState,
    type MetricApplicability,
    type MetricKey,
    type ProvisioningState,
    type TimeRange,
} from '../../api/types';
import { type ContainerRef, type MetricScope } from './metrics/descriptors';

const cosmosIcon = new URL('../../../../resources/azurecosmosdb.png', import.meta.url).href;
const timeRanges: { value: TimeRange; label: string }[] = [
    { value: '1H', label: l10n.t('Last hour') },
    { value: '24H', label: l10n.t('Last 24 hours') },
    { value: '7D', label: l10n.t('Last 7 days') },
];

export type AccountSummary = {
    accountName: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    apiType: string;
    documentEndpoint: string;
    isServerless: boolean;
    metricApplicability: Record<MetricKey, MetricApplicability>;
    provisioningState?: ProvisioningState;
    consistencyLevel?: string;
    freeTierEnabled: boolean;
    backupPolicyType?: string;
    backupIntervalMinutes?: number;
    backupRetentionHours?: number;
    continuousBackupTier?: string;
    automaticFailoverEnabled?: boolean;
    totalThroughputLimit?: number | null;
    writeRegions: string[];
    readRegions: string[];
    writeRegionCount: number;
    readRegionCount: number;
    lastRefreshedAt: number;
};

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXL,
        minWidth: 0,
    },
    topRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalM,
        flexWrap: 'wrap',
    },
    titleBlock: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
        minWidth: 0,
    },
    identity: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalM,
        minWidth: 0,
    },
    icon: {
        width: '32px',
        height: '32px',
        flexShrink: 0,
    },
    title: {
        ...typographyStyles.subtitle1,
        margin: 0,
        overflowWrap: 'anywhere',
    },
    subtitle: {
        ...typographyStyles.caption1,
        margin: 0,
        color: tokens.colorNeutralForeground2,
    },
    controls: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
        minWidth: 0,
        maxWidth: '100%',
    },
    select: {
        minWidth: 0,
        maxWidth: '100%',
    },
    refreshText: {
        ...typographyStyles.caption1,
        color: tokens.colorNeutralForeground2,
        overflowWrap: 'anywhere',
    },
    status: {
        ...typographyStyles.body1,
        border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
        borderRadius: tokens.borderRadiusLarge,
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    statusItems: {
        display: 'flex',
        alignItems: 'center',
        rowGap: tokens.spacingVerticalS,
        columnGap: tokens.spacingHorizontalL,
        flexWrap: 'wrap',
        flex: 1,
        minWidth: 0,
        overflowWrap: 'anywhere',
        '& > * + *': {
            borderLeft: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
            paddingLeft: tokens.spacingHorizontalL,
        },
        '@media (max-width: 700px)': {
            flexBasis: '100%',
        },
    },
    statusValue: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalSNudge,
    },
    throughputLimit: {
        ':focus-visible': {
            outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: tokens.strokeWidthThick,
        },
    },
    statusDot: {
        width: '6px',
        height: '6px',
        borderRadius: tokens.borderRadiusCircular,
        backgroundColor: 'currentColor',
    },
    detailsToggle: {
        marginLeft: 'auto',
    },
    detailBody: {
        borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
        margin: `${tokens.spacingVerticalS} calc(-1 * ${tokens.spacingHorizontalM}) calc(-1 * ${tokens.spacingVerticalS})`,
        padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalM}`,
    },
    essentialsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
        columnGap: tokens.spacingHorizontalXL,
        rowGap: tokens.spacingVerticalM,
    },
    detailFooter: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: tokens.spacingHorizontalS,
        marginTop: tokens.spacingVerticalM,
    },
    additionalPropertiesPanel: {
        margin: `${tokens.spacingVerticalM} 0 0`,
    },
    essentialItem: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
        minWidth: 0,
    },
    essentialLabel: {
        ...typographyStyles.caption1,
        color: tokens.colorNeutralForeground2,
    },
    essentialValue: {
        ...typographyStyles.body1,
        display: 'block',
        maxWidth: '100%',
        overflowWrap: 'anywhere',
    },
    srOnly: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clipPath: 'inset(50%)',
        whiteSpace: 'nowrap',
        border: 0,
    },
});

function formatRefreshTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString(undefined, {
        dateStyle: 'short',
        timeStyle: 'medium',
    });
}

function healthFromProvisioning(state: ProvisioningState | undefined): { tone: BadgeProps['color']; label: string } {
    switch (state) {
        case 'Succeeded':
            return { tone: 'success', label: l10n.t('Healthy') };
        case 'Creating':
        case 'Updating':
        case 'Deleting':
            return { tone: 'warning', label: l10n.t('Needs Attention') };
        case 'Failed':
        case 'Canceled':
            return { tone: 'danger', label: l10n.t('Critical') };
        case undefined:
        default:
            return { tone: 'subtle', label: l10n.t('Unknown') };
    }
}

/** Maps a derived {@link HealthState} (provisioning + throttling) to a badge color and localized label. */
function healthFromState(state: HealthState): { tone: BadgeProps['color']; label: string } {
    switch (state) {
        case 'Healthy':
            return { tone: 'success', label: l10n.t('Healthy') };
        case 'Needs Attention':
            return { tone: 'warning', label: l10n.t('Needs Attention') };
        case 'Critical':
            return { tone: 'danger', label: l10n.t('Critical') };
    }
}

const EssentialField = ({ label, value }: { label: string; value: string }) => {
    const styles = useStyles();

    return (
        <div className={styles.essentialItem}>
            <Text className={styles.essentialLabel}>{label}</Text>
            <Text className={styles.essentialValue}>{value}</Text>
        </div>
    );
};

export const AccountHeader = ({
    navigationRevision = 0,
    summary,
    accountHealth,
    lastRefreshedAt,
    onRefresh,
    loading = false,
    refreshDisabled = false,
    defaultEssentialsOpen = false,
    timeRange,
    onTimeRangeChange,
    containers,
    selectedContainer,
    onSelectContainer,
    databaseIds,
    accountActionBusy,
    onAccountAction,
}: {
    navigationRevision?: number;
    summary: AccountSummary;
    accountHealth?: HealthState;
    lastRefreshedAt?: number;
    onRefresh: () => void;
    loading?: boolean;
    refreshDisabled?: boolean;
    defaultEssentialsOpen?: boolean;
    timeRange: TimeRange;
    onTimeRangeChange: (range: TimeRange) => void;
    containers: ContainerRef[];
    selectedContainer?: MetricScope;
    onSelectContainer: (scope?: MetricScope) => void;
    databaseIds?: string[];
    accountActionBusy: boolean;
    onAccountAction: (input: AccountActionInput) => void;
}) => {
    const styles = useStyles();
    const id = useId();
    const controlsDisabled = loading || refreshDisabled;
    // Dropdown has no disabledFocusable prop. Keep the trigger focusable while its disabled state blocks interaction.
    const filterButtonProps = { disabled: false, 'aria-disabled': controlsDisabled, tabIndex: 0 };
    const loadingDescription = loading
        ? l10n.t('Updating…')
        : refreshDisabled
          ? l10n.t('Account data is still loading.')
          : undefined;
    const [essentialsOpen, setEssentialsOpen] = useState(defaultEssentialsOpen);
    const [additionalPropertiesOpen, setAdditionalPropertiesOpen] = useState(false);
    const health = accountHealth ? healthFromState(accountHealth) : healthFromProvisioning(summary.provisioningState);
    const databases = useMemo(
        () => [...new Set(databaseIds ?? containers.map((container) => container.databaseId))].sort(),
        [containers, databaseIds],
    );
    const selectedDatabaseIndex = selectedContainer ? databases.indexOf(selectedContainer.databaseId) : -1;
    const selectedScopeLabel = selectedContainer?.databaseId ?? l10n.t('All databases');
    const timeRangeLabel = timeRanges.find((range) => range.value === timeRange)?.label;
    const throughputLimit =
        summary.isServerless || summary.totalThroughputLimit === -1
            ? l10n.t('No total throughput limit')
            : summary.totalThroughputLimit !== undefined &&
                summary.totalThroughputLimit !== null &&
                Number.isFinite(summary.totalThroughputLimit) &&
                summary.totalThroughputLimit >= 0
              ? l10n.t('{ru} RU/s', { ru: summary.totalThroughputLimit.toLocaleString() })
              : l10n.t('Unknown');
    const throughputLimitExplanation = summary.isServerless
        ? l10n.t('The account-wide provisioned-throughput cap is not applicable to serverless accounts.')
        : l10n.t(
              'This account-wide cap limits throughput allocation, not consumed RU or available performance. Autoscale resources count at their configured maximum.',
          );
    const capacityMode = summary.isServerless ? l10n.t('Serverless') : l10n.t('Provisioned throughput');
    const retention =
        summary.backupRetentionHours === undefined
            ? summary.continuousBackupTier
            : summary.backupRetentionHours % 24 === 0
              ? l10n.t('{days} days retention', { days: summary.backupRetentionHours / 24 })
              : l10n.t('{hours} hours retention', { hours: summary.backupRetentionHours });
    const backupPolicy = retention
        ? `${summary.backupPolicyType ?? l10n.t('Unknown')} (${retention})`
        : (summary.backupPolicyType ?? l10n.t('Unknown'));

    const essentials: { label: string; value: string }[] = [
        { label: l10n.t('Status'), value: health.label },
        { label: l10n.t('Resource group'), value: summary.resourceGroup },
        { label: l10n.t('Subscription'), value: summary.subscriptionName },
        { label: l10n.t('Subscription ID'), value: summary.subscriptionId },
        { label: l10n.t('URI'), value: summary.documentEndpoint },
        {
            label: l10n.t('Capacity mode'),
            value: capacityMode,
        },
        {
            label: l10n.t('Total throughput limit'),
            value: throughputLimit,
        },
        {
            label: l10n.t('Backup policy'),
            value:
                summary.backupPolicyType === 'Periodic' && summary.backupIntervalMinutes !== undefined
                    ? l10n.t('{policy}; backup every {minutes} minutes', {
                          policy: backupPolicy,
                          minutes: summary.backupIntervalMinutes,
                      })
                    : backupPolicy,
        },
        { label: l10n.t('Free tier'), value: summary.freeTierEnabled ? l10n.t('Enabled') : l10n.t('Opted out') },
        {
            label: l10n.t('Write locations'),
            value: summary.writeRegions.length ? summary.writeRegions.join(', ') : '—',
        },
        { label: l10n.t('Read locations'), value: summary.readRegions.length ? summary.readRegions.join(', ') : '—' },
    ];
    const additionalProperties = [
        { label: l10n.t('API type'), value: summary.apiType },
        { label: l10n.t('Consistency'), value: summary.consistencyLevel ?? l10n.t('Unknown') },
        {
            label: l10n.t('Automatic failover'),
            value:
                summary.automaticFailoverEnabled === undefined
                    ? l10n.t('Unknown')
                    : summary.automaticFailoverEnabled
                      ? l10n.t('Enabled')
                      : l10n.t('Disabled'),
        },
    ];

    const regionsLabel =
        [...new Set([...summary.writeRegions, ...summary.readRegions])].join(', ') || l10n.t('Unknown');

    return (
        <header className={styles.root}>
            <output className={styles.srOnly} aria-live="polite">
                {l10n.t('Account health: {status}', { status: health.label })}
            </output>
            <div className={styles.topRow}>
                <div className={styles.identity}>
                    <img className={styles.icon} src={cosmosIcon} alt="" />
                    <div className={styles.titleBlock}>
                        <h1 className={styles.title}>{summary.accountName}</h1>
                        <p className={styles.subtitle}>{l10n.t('Azure Cosmos DB account')}</p>
                    </div>
                </div>
                <div className={styles.controls}>
                    {lastRefreshedAt !== undefined && (
                        <time dateTime={new Date(lastRefreshedAt).toISOString()} className={styles.refreshText}>
                            {l10n.t('Charts generated at {time}', { time: formatRefreshTime(lastRefreshedAt) })}
                        </time>
                    )}
                    <Dropdown
                        key={`time-${navigationRevision}`}
                        className={styles.select}
                        size="small"
                        inlinePopup
                        disabled={controlsDisabled}
                        button={filterButtonProps}
                        aria-label={l10n.t('Metric time range: {range}', { range: timeRangeLabel ?? timeRange })}
                        aria-description={loadingDescription}
                        value={timeRangeLabel ?? timeRange}
                        selectedOptions={[timeRange]}
                        onOptionSelect={(_, data) => {
                            if (controlsDisabled) {
                                return;
                            }
                            const range = timeRanges.find((range) => range.value === data.optionValue);
                            if (range) {
                                onTimeRangeChange(range.value);
                            }
                        }}
                    >
                        {timeRanges.map((range) => (
                            <Option key={range.value} value={range.value}>
                                {range.label}
                            </Option>
                        ))}
                    </Dropdown>
                    <Dropdown
                        key={`database-${navigationRevision}`}
                        className={styles.select}
                        size="small"
                        inlinePopup
                        disabled={controlsDisabled}
                        button={filterButtonProps}
                        aria-label={l10n.t('Database scope for metrics: {scope}', { scope: selectedScopeLabel })}
                        aria-description={loadingDescription}
                        value={selectedScopeLabel}
                        selectedOptions={[String(selectedDatabaseIndex)]}
                        onOptionSelect={(_, data) => {
                            if (controlsDisabled) {
                                return;
                            }
                            if (data.optionValue === '-1') {
                                onSelectContainer(undefined);
                            } else {
                                const databaseId = databases.find((_, index) => String(index) === data.optionValue);
                                if (databaseId !== undefined) {
                                    onSelectContainer({ databaseId });
                                }
                            }
                        }}
                    >
                        <Option value="-1">{l10n.t('All databases')}</Option>
                        {databases.map((database, index) => (
                            <Option key={database} value={String(index)}>
                                {database}
                            </Option>
                        ))}
                    </Dropdown>
                    <Button
                        appearance="secondary"
                        size="small"
                        icon={loading ? <Spinner size="tiny" aria-hidden /> : <ArrowClockwise16Regular aria-hidden />}
                        disabledFocusable={controlsDisabled}
                        aria-busy={loading}
                        aria-description={loadingDescription}
                        onClick={controlsDisabled ? undefined : onRefresh}
                    >
                        {l10n.t('Refresh')}
                    </Button>
                </div>
            </div>
            <p className={styles.subtitle}>
                {l10n.t(
                    'Time and database scope apply to metric trends. Inventory is account-wide; alerts and advisories use their own time windows.',
                )}
            </p>

            <Accordion
                className={styles.status}
                collapsible
                openItems={essentialsOpen ? ['details'] : []}
                onToggle={(_, data) => setEssentialsOpen(data.openItems.includes('details'))}
            >
                <AccordionItem value="details">
                    <div className={styles.topRow}>
                        <div className={styles.statusItems}>
                            <div className={styles.statusValue}>
                                <span>{l10n.t('Status:')}</span>
                                <Badge
                                    appearance="tint"
                                    shape="circular"
                                    color={health.tone}
                                    icon={<span className={styles.statusDot} aria-hidden />}
                                >
                                    {health.label}
                                </Badge>
                            </div>
                            <span>{l10n.t('Regions: {regions}', { regions: regionsLabel })}</span>
                            <span>{l10n.t('Capacity mode: {mode}', { mode: capacityMode })}</span>
                            <Tooltip content={throughputLimitExplanation} relationship="description">
                                {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Tooltip focus. */}
                                <span tabIndex={0} className={styles.throughputLimit}>
                                    {l10n.t('Total throughput limit: {limit}', { limit: throughputLimit })}
                                </span>
                            </Tooltip>
                        </div>
                        <AccordionHeader
                            as="h2"
                            inline
                            size="small"
                            className={styles.detailsToggle}
                            expandIconPosition="end"
                            button={{ id: `${id}-toggle`, 'aria-controls': `${id}-details` }}
                        >
                            {l10n.t('Account details')}
                        </AccordionHeader>
                    </div>
                    <AccordionPanel
                        className={styles.detailBody}
                        // AccordionPanel only supports a div root.
                        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                        role="region"
                        id={`${id}-details`}
                        aria-labelledby={`${id}-toggle`}
                        collapseMotion={{
                            children: (Component, props) => <Component {...props} unmountOnExit={false} />,
                        }}
                    >
                        <div className={styles.essentialsGrid}>
                            {essentials.map((field) => (
                                <EssentialField key={field.label} label={field.label} value={field.value} />
                            ))}
                        </div>
                        <Accordion
                            collapsible
                            openItems={additionalPropertiesOpen ? ['properties'] : []}
                            onToggle={(_, data) => setAdditionalPropertiesOpen(data.openItems.includes('properties'))}
                        >
                            <AccordionItem value="properties">
                                <div className={styles.detailFooter}>
                                    <Button
                                        appearance="secondary"
                                        size="small"
                                        icon={<Money16Regular aria-hidden />}
                                        disabled={accountActionBusy}
                                        onClick={() => onAccountAction({ action: 'openCosts' })}
                                    >
                                        {l10n.t('View Cost')}
                                    </Button>
                                    <Button
                                        appearance="secondary"
                                        size="small"
                                        icon={<Braces16Regular aria-hidden />}
                                        disabled={accountActionBusy}
                                        onClick={() => onAccountAction({ action: 'openJson' })}
                                    >
                                        {l10n.t('View JSON')}
                                    </Button>
                                    <AccordionHeader
                                        as="h3"
                                        inline
                                        size="small"
                                        className={styles.detailsToggle}
                                        button={{
                                            id: `${id}-properties-toggle`,
                                            'aria-controls': `${id}-properties`,
                                        }}
                                    >
                                        {l10n.t('Additional account properties')}
                                    </AccordionHeader>
                                </div>
                                <AccordionPanel
                                    className={mergeClasses(styles.essentialsGrid, styles.additionalPropertiesPanel)}
                                    // AccordionPanel only supports a div root.
                                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                                    role="region"
                                    id={`${id}-properties`}
                                    aria-labelledby={`${id}-properties-toggle`}
                                    collapseMotion={{
                                        children: (Component, props) => <Component {...props} unmountOnExit={false} />,
                                    }}
                                >
                                    {additionalProperties.map((field) => (
                                        <EssentialField key={field.label} label={field.label} value={field.value} />
                                    ))}
                                </AccordionPanel>
                            </AccordionItem>
                        </Accordion>
                    </AccordionPanel>
                </AccordionItem>
            </Accordion>
        </header>
    );
};
