/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Small, presentational building blocks shared across the wizard pages.
 *
 * They are intentionally dumb (props in, markup out) and carry no wizard
 * state, so pages stay self-contained and portable to a future wizard package.
 */

import { makeStyles, mergeClasses, Text, tokens } from '@fluentui/react-components';
import { type PropsWithChildren, type ReactNode } from 'react';

const useStyles = makeStyles({
    pageHeader: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXS,
        marginBottom: tokens.spacingVerticalL,
    },
    pageTitle: {
        fontSize: tokens.fontSizeBase500,
        fontWeight: tokens.fontWeightSemibold,
    },
    pageDesc: {
        color: tokens.colorNeutralForeground3,
    },
    // Responsive 2-column layout: sidebar collapses under the main content on narrow widths.
    twoCol: {
        display: 'grid',
        gridTemplateColumns: 'minmax(180px, 220px) minmax(0, 1fr)',
        gap: tokens.spacingHorizontalXL,
        alignItems: 'start',
        '@media (max-width: 720px)': {
            gridTemplateColumns: '1fr',
        },
    },
    twoColReverse: {
        '@media (max-width: 720px)': {
            display: 'flex',
            flexDirection: 'column-reverse',
        },
    },
    sidebar: {
        position: 'sticky',
        top: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground2,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        '@media (max-width: 720px)': {
            position: 'static',
        },
    },
    sidebarTitle: {
        fontWeight: tokens.fontWeightSemibold,
    },
    sidebarList: {
        margin: 0,
        paddingLeft: tokens.spacingHorizontalL,
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
        color: tokens.colorNeutralForeground2,
        fontSize: tokens.fontSizeBase200,
    },
    infoBox: {
        display: 'flex',
        gap: tokens.spacingHorizontalS,
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground3,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground2,
    },
    mythBox: {
        display: 'flex',
        gap: tokens.spacingHorizontalM,
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground2,
        borderLeft: `3px solid ${tokens.colorBrandStroke1}`,
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground2,
    },
    mythIcon: {
        fontSize: tokens.fontSizeBase500,
        lineHeight: 1,
    },
    subPanel: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground2,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    subPanelTitle: {
        fontWeight: tokens.fontWeightSemibold,
    },
    subPanelSub: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
    sectionHead: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        fontWeight: tokens.fontWeightSemibold,
        marginTop: tokens.spacingVerticalM,
        marginBottom: tokens.spacingVerticalXS,
    },
    countBadge: {
        padding: `2px ${tokens.spacingHorizontalS}`,
        borderRadius: tokens.borderRadiusCircular,
        backgroundColor: tokens.colorNeutralBackground4,
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase100,
        fontWeight: tokens.fontWeightRegular,
    },
    metricPill: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalS}`,
        borderRadius: tokens.borderRadiusCircular,
        backgroundColor: tokens.colorNeutralBackground4,
        fontSize: tokens.fontSizeBase200,
        whiteSpace: 'nowrap',
    },
    fieldGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXS,
        marginBottom: tokens.spacingVerticalL,
    },
    fieldLabel: {
        fontWeight: tokens.fontWeightSemibold,
        fontSize: tokens.fontSizeBase300,
    },
    hint: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
    pillRow: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: tokens.spacingHorizontalS,
    },
});

export function PageHeader({ title, description }: { title: string; description: string }) {
    const styles = useStyles();
    return (
        <div className={styles.pageHeader}>
            <Text as="h2" className={styles.pageTitle}>
                {title}
            </Text>
            <Text className={styles.pageDesc}>{description}</Text>
        </div>
    );
}

export function TwoColumn({ children, reverseOnNarrow }: PropsWithChildren<{ reverseOnNarrow?: boolean }>) {
    const styles = useStyles();
    return <div className={mergeClasses(styles.twoCol, reverseOnNarrow && styles.twoColReverse)}>{children}</div>;
}

export function SidebarInfo({ title, items, note }: { title: string; items: ReactNode[]; note?: ReactNode }) {
    const styles = useStyles();
    return (
        <aside className={styles.sidebar}>
            <Text className={styles.sidebarTitle}>{title}</Text>
            <ul className={styles.sidebarList}>
                {items.map((item, i) => (
                    <li key={i}>{item}</li>
                ))}
            </ul>
            {note ? <div className={styles.infoBox}>{note}</div> : null}
        </aside>
    );
}

export function InfoBox({ children }: PropsWithChildren) {
    const styles = useStyles();
    return <div className={styles.infoBox}>{children}</div>;
}

export function MythBox({ icon = '💡', children }: PropsWithChildren<{ icon?: string }>) {
    const styles = useStyles();
    return (
        <div className={styles.mythBox}>
            <span className={styles.mythIcon} aria-hidden="true">
                {icon}
            </span>
            <div>{children}</div>
        </div>
    );
}

export function SubPanel({ title, subtitle, children }: PropsWithChildren<{ title: string; subtitle?: ReactNode }>) {
    const styles = useStyles();
    return (
        <section className={styles.subPanel}>
            <Text className={styles.subPanelTitle}>{title}</Text>
            {subtitle ? <Text className={styles.subPanelSub}>{subtitle}</Text> : null}
            {children}
        </section>
    );
}

export function SectionHead({ children, count }: PropsWithChildren<{ count?: string }>) {
    const styles = useStyles();
    return (
        <div className={styles.sectionHead}>
            <span>{children}</span>
            {count ? <span className={styles.countBadge}>{count}</span> : null}
        </div>
    );
}

export function MetricPill({ children }: PropsWithChildren) {
    const styles = useStyles();
    return <span className={styles.metricPill}>{children}</span>;
}

export function PillRow({ children }: PropsWithChildren) {
    const styles = useStyles();
    return <div className={styles.pillRow}>{children}</div>;
}

export function FieldGroup({ label, hint, children }: PropsWithChildren<{ label?: ReactNode; hint?: ReactNode }>) {
    const styles = useStyles();
    return (
        <div className={styles.fieldGroup}>
            {label ? <Text className={styles.fieldLabel}>{label}</Text> : null}
            {hint ? <Text className={styles.hint}>{hint}</Text> : null}
            {children}
        </div>
    );
}
