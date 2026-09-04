/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, Text, tokens } from '@fluentui/react-components';
import { type JSX } from 'react';
import { type ContainerHeaderProps } from './Container.types.js';

const useStyles = makeStyles({
    header: { gridArea: 'header', display: 'flex', alignItems: 'center', gap: '16px' },
    // A fixed box rather than styling the glyph itself, so an <img> and an icon font both fit.
    media: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '56px',
        height: '56px',
        flexShrink: 0,
        color: tokens.colorBrandForeground1,
        fontSize: '56px',
        lineHeight: 1,
        '> *': { maxWidth: '100%', maxHeight: '100%' },
    },
    copy: { minWidth: 0 },
    subtitle: { color: tokens.colorNeutralForeground2 },
    action: { marginInlineStart: 'auto', flexShrink: 0 },
});

/**
 * The identifying block at the top of a {@link Container}: media, title, subtitle, and an
 * end-aligned action.
 *
 * Structurally Fluent's `CardHeader` (`image` / `header` / `description` / `action`) at surface
 * scale.
 */
export const ContainerHeader = ({
    media,
    title,
    subtitle,
    action,
    headingLevel = 1,
    className,
    ...rest
}: ContainerHeaderProps): JSX.Element => {
    const styles = useStyles();

    return (
        <div className={mergeClasses(styles.header, className)} {...rest}>
            {media !== undefined && media !== null && <div className={styles.media}>{media}</div>}
            <div className={styles.copy}>
                <Text as={headingLevel === 1 ? 'h1' : 'h2'} size={700} weight="semibold">
                    {title}
                </Text>
                {subtitle !== undefined &&
                    subtitle !== null && (
                        // `Text` is inline; the wrapper is what puts the subtitle on its own line.
                        <div>
                            <Text className={styles.subtitle}>{subtitle}</Text>
                        </div>
                    )}
            </div>
            {action !== undefined && action !== null && <div className={styles.action}>{action}</div>}
        </div>
    );
};
