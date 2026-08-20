/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { type ReactNode } from 'react';

/**
 * A radio-style selectable card. Behaves like a single-choice option: exactly
 * one card in a group should be `selected`. Fully keyboard operable.
 */

const useStyles = makeStyles({
    card: {
        display: 'flex',
        gap: tokens.spacingHorizontalM,
        alignItems: 'flex-start',
        width: '100%',
        textAlign: 'left',
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground1,
        cursor: 'pointer',
        color: tokens.colorNeutralForeground1,
        ':hover': {
            backgroundColor: tokens.colorNeutralBackground1Hover,
            border: `1px solid ${tokens.colorNeutralStroke1}`,
        },
    },
    cardSelected: {
        border: `1px solid ${tokens.colorBrandStroke1}`,
        backgroundColor: tokens.colorNeutralBackground1Selected,
        boxShadow: `inset 0 0 0 1px ${tokens.colorBrandStroke1}`,
    },
    radio: {
        flexShrink: 0,
        marginTop: '2px',
        width: '16px',
        height: '16px',
        borderRadius: tokens.borderRadiusCircular,
        border: `2px solid ${tokens.colorNeutralStroke1}`,
        boxSizing: 'border-box',
        position: 'relative',
    },
    radioSelected: {
        border: `2px solid ${tokens.colorBrandStroke1}`,
        '::after': {
            content: '""',
            position: 'absolute',
            inset: '2px',
            borderRadius: tokens.borderRadiusCircular,
            backgroundColor: tokens.colorBrandForeground1,
        },
    },
    body: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        minWidth: 0,
    },
    title: {
        fontWeight: tokens.fontWeightSemibold,
    },
    desc: {
        color: tokens.colorNeutralForeground3,
        fontSize: tokens.fontSizeBase200,
    },
});

export interface SelectableCardProps {
    selected: boolean;
    onSelect: () => void;
    title: ReactNode;
    description?: ReactNode;
    /** Extra content rendered under the description (badges, hints, etc.). */
    meta?: ReactNode;
    ariaLabel?: string;
}

export function SelectableCard({ selected, onSelect, title, description, meta, ariaLabel }: SelectableCardProps) {
    const styles = useStyles();
    return (
        <button
            type="button"
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- styled radio card; a native <input> cannot host the card layout/children
            role="radio"
            aria-checked={selected}
            aria-label={ariaLabel}
            className={mergeClasses(styles.card, selected && styles.cardSelected)}
            onClick={onSelect}
        >
            <span className={mergeClasses(styles.radio, selected && styles.radioSelected)} aria-hidden="true" />
            <span className={styles.body}>
                <span className={styles.title}>{title}</span>
                {description ? <span className={styles.desc}>{description}</span> : null}
                {meta}
            </span>
        </button>
    );
}
