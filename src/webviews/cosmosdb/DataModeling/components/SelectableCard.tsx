/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { type ReactNode, useId } from 'react';

/**
 * A native radio styled as a selectable card. Cards in a group share a name
 * so the browser manages Tab entry and arrow-key selection.
 */

const useStyles = makeStyles({
    card: {
        display: 'flex',
        gap: tokens.spacingHorizontalM,
        alignItems: 'flex-start',
        width: '100%',
        boxSizing: 'border-box',
        textAlign: 'left',
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground1,
        cursor: 'pointer',
        color: tokens.colorNeutralForeground1,
        ':focus-within': {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: '2px',
        },
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
        margin: 0,
        marginTop: '2px',
        width: '16px',
        height: '16px',
        accentColor: tokens.colorBrandBackground,
        cursor: 'pointer',
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
    name: string;
    value: string;
    selected: boolean;
    onSelect: () => void;
    title: ReactNode;
    description?: ReactNode;
    /** Extra content rendered under the description (badges, hints, etc.). */
    meta?: ReactNode;
}

export function SelectableCard({ name, value, selected, onSelect, title, description, meta }: SelectableCardProps) {
    const styles = useStyles();
    const id = useId();
    const titleId = `${id}-title`;
    const descriptionId = `${id}-description`;
    const metaId = `${id}-meta`;
    const describedBy = [description ? descriptionId : undefined, meta ? metaId : undefined].filter(Boolean).join(' ');
    return (
        <label className={mergeClasses(styles.card, selected && styles.cardSelected)}>
            <input
                className={styles.radio}
                type="radio"
                name={name}
                value={value}
                checked={selected}
                onChange={onSelect}
                aria-labelledby={titleId}
                aria-describedby={describedBy || undefined}
            />
            <span className={styles.body}>
                <span id={titleId} className={styles.title}>
                    {title}
                </span>
                {description ? (
                    <span id={descriptionId} className={styles.desc}>
                        {description}
                    </span>
                ) : null}
                {meta ? <span id={metaId}>{meta}</span> : null}
            </span>
        </label>
    );
}
