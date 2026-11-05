/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { type ReactNode, useId } from 'react';

/**
 * A native radio styled as a selectable card. Cards in a group share a name
 * so the browser manages Tab entry and arrow-key selection. The card owns the
 * keyboard-focus outline, and the CSS indicator keeps its themed color across pointer states.
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
        ':has(> input:focus-visible)': {
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
        appearance: 'none',
        display: 'grid',
        placeItems: 'center',
        boxSizing: 'border-box',
        flexShrink: 0,
        margin: 0,
        marginTop: '2px',
        width: '16px',
        height: '16px',
        border: '1px solid currentColor',
        borderRadius: '50%',
        color: tokens.colorNeutralStrokeAccessible,
        backgroundColor: tokens.colorNeutralBackground1,
        cursor: 'pointer',
        '::before': {
            content: '""',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: 'currentColor',
            opacity: 0,
        },
        ':checked': {
            color: tokens.colorCompoundBrandForeground1,
            '::before': {
                opacity: 1,
            },
        },
        ':focus': {
            outlineStyle: 'none',
        },
        '@media (forced-colors: active)': {
            color: 'CanvasText',
            ':checked': {
                color: 'Highlight',
            },
            '::before': {
                forcedColorAdjust: 'none',
            },
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
