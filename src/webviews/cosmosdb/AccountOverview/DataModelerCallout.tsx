/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Body1Strong,
    Button,
    makeStyles,
    mergeClasses,
    Text,
    tokens,
    typographyStyles,
    useId,
} from '@fluentui/react-components';
import { ChevronDown16Regular, ChevronUp16Regular, Diagram20Regular, DiagramRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type Ref } from 'react';
import { ThemedTooltip as Tooltip } from '../../common/ThemedTooltip';

const useStyles = makeStyles({
    root: {
        position: 'relative',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: tokens.spacingHorizontalL,
        rowGap: tokens.spacingVerticalS,
        marginBottom: tokens.spacingVerticalM,
        // Leaves room for the absolutely positioned close button so it never crowds the copy or the action.
        padding: `${tokens.spacingVerticalM} calc(${tokens.spacingHorizontalXXXL} + ${tokens.spacingHorizontalL}) ${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
        borderRadius: tokens.borderRadiusMedium,
        border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
        borderLeft: `${tokens.strokeWidthThicker} solid ${tokens.colorBrandStroke1}`,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    content: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
        // Lets the action wrap below the copy in narrow panels instead of squeezing the text.
        flex: '1 1 280px',
        minWidth: 0,
    },
    eyebrow: {
        ...typographyStyles.caption1Strong,
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
        color: tokens.colorBrandForeground1,
    },
    heading: {
        margin: 0,
    },
    description: {
        ...typographyStyles.caption1,
        color: tokens.colorNeutralForeground2,
    },
    action: {
        flexShrink: 0,
        // Keeps a clear gap between the primary action and the close button on wide panels.
        marginRight: tokens.spacingHorizontalXL,
    },
    collapse: {
        position: 'absolute',
        top: tokens.spacingVerticalXS,
        right: tokens.spacingHorizontalXS,
    },
    compact: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXXS,
        marginLeft: 'auto',
    },
    toggle: {
        minWidth: 'auto',
        color: tokens.colorNeutralForeground3,
    },
});

const dataModelerDescription = () =>
    l10n.t(
        "Get a guided experience to design your containers and relationships, choose partition keys based on your application's queries and workload, and deploy when you're ready.",
    );

/**
 * Prominent, benefit-led entry point to the guided Data Modeler experience on the Account Overview.
 * Keeps the Data Modeler name visible so users can connect the feature with the guided workflow.
 * Users can collapse it to reclaim space; {@link DataModelerCompactEntry} then keeps the feature reachable.
 */
export function DataModelerCallout({
    disabled,
    collapseRef,
    onStart,
    onCollapse,
}: {
    disabled: boolean;
    collapseRef?: Ref<HTMLButtonElement>;
    onStart: () => void;
    onCollapse: () => void;
}) {
    const styles = useStyles();
    const headingId = useId('data-modeler-callout-heading');
    const descriptionId = useId('data-modeler-callout-description');

    return (
        <section className={styles.root} aria-labelledby={headingId}>
            <div className={styles.content}>
                <span className={styles.eyebrow}>
                    <Diagram20Regular aria-hidden />
                    {l10n.t('Data Modeler')}
                </span>
                <Body1Strong as="h2" id={headingId} className={styles.heading}>
                    {l10n.t('Need help designing your data model?')}
                </Body1Strong>
                <Text id={descriptionId} className={styles.description}>
                    {dataModelerDescription()}
                </Text>
            </div>
            <Button
                className={styles.action}
                appearance="primary"
                disabled={disabled}
                aria-describedby={descriptionId}
                onClick={onStart}
            >
                {l10n.t('Start guided data modeling')}
            </Button>
            <Tooltip
                content={l10n.t('Data Modeler stays available in the account actions.')}
                relationship="description"
            >
                <Button
                    ref={collapseRef}
                    className={mergeClasses(styles.toggle, styles.collapse)}
                    appearance="transparent"
                    size="small"
                    icon={<ChevronUp16Regular aria-hidden />}
                    aria-label={l10n.t('Collapse Data Modeler suggestion')}
                    aria-expanded
                    onClick={onCollapse}
                />
            </Tooltip>
        </section>
    );
}

/**
 * Discreet Data Modeler entry shown in the account action row after the callout is collapsed.
 * A subtle expand control restores the full callout.
 */
export function DataModelerCompactEntry({
    disabled,
    expandRef,
    onStart,
    onExpand,
}: {
    disabled: boolean;
    expandRef?: Ref<HTMLButtonElement>;
    onStart: () => void;
    onExpand: () => void;
}) {
    const styles = useStyles();
    const expandLabel = l10n.t('Expand Data Modeler suggestion');
    return (
        <span className={styles.compact}>
            <Tooltip content={dataModelerDescription()} relationship="description">
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<DiagramRegular aria-hidden />}
                    disabledFocusable={disabled}
                    onClick={onStart}
                >
                    {l10n.t('Data Modeler')}
                </Button>
            </Tooltip>
            <Tooltip content={expandLabel} relationship="label">
                <Button
                    ref={expandRef}
                    className={styles.toggle}
                    appearance="transparent"
                    size="small"
                    icon={<ChevronDown16Regular aria-hidden />}
                    aria-expanded={false}
                    onClick={onExpand}
                />
            </Tooltip>
        </span>
    );
}
