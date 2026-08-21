/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, Text, tokens } from '@fluentui/react-components';
import { InfoRegular } from '@fluentui/react-icons';
import { type JSX } from 'react';
import { useContainerContext } from '../contexts/container.js';
import { type ContainerFooterProps } from './Container.types.js';

const useStyles = makeStyles({
    footer: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: '12px',
        flexShrink: 0,
        padding: '16px 24px',
        backgroundColor: tokens.colorNeutralBackground1,
        borderTop: '1px solid transparent',
        transitionProperty: 'box-shadow, border-top-color',
        transitionDuration: tokens.durationNormal,
        transitionTimingFunction: tokens.curveEasyEase,
    },
    elevated: {
        borderTopColor: tokens.colorNeutralStroke2,
        boxShadow: '0 -2px 6px rgba(0, 0, 0, 0.08)',
    },
    actions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' },
    contentEnd: { marginInlineStart: 'auto' },
    note: { display: 'flex', alignItems: 'flex-start', gap: '8px', color: tokens.colorNeutralForeground2 },
    // Block layout drops the inline descender space, so the glyph shares the text's first line box.
    noteIcon: {
        color: tokens.colorNeutralForeground3,
        display: 'block',
        fontSize: '16px',
        height: tokens.lineHeightBase200,
        flexShrink: 0,
    },
});

/**
 * The pinned action bar of a {@link Container}: an optional note above a row of buttons.
 *
 * It elevates itself with a top border and a shadow, but only while the body still has content
 * below the fold, so a short surface keeps a flat, quiet footer. That is read from the `Container`
 * context; the consumer wires nothing.
 */
export const ContainerFooter = ({
    note,
    contentEnd,
    children,
    className,
    ...rest
}: ContainerFooterProps): JSX.Element => {
    const styles = useStyles();
    const { overflowing } = useContainerContext();

    return (
        <div className={mergeClasses(styles.footer, overflowing && styles.elevated, className)} {...rest}>
            {note !== undefined && note !== null && (
                <div className={styles.note}>
                    <InfoRegular aria-hidden className={styles.noteIcon} />
                    <Text size={200}>{note}</Text>
                </div>
            )}
            <div className={styles.actions}>
                {children}
                {contentEnd !== undefined && contentEnd !== null && (
                    <div className={styles.contentEnd}>{contentEnd}</div>
                )}
            </div>
        </div>
    );
};
