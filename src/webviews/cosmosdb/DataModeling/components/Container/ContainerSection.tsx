/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, Text, tokens, useId } from '@fluentui/react-components';
import { type JSX, useEffect, useRef } from 'react';
import { useContainerContext } from '../contexts/container.js';
import { type ContainerSectionProps } from './Container.types.js';

const useStyles = makeStyles({
    section: { display: 'flex', flexDirection: 'column', gap: '12px' },
    // A heading belongs to what follows it, so the gap under it is tighter than the section's own.
    header: { display: 'flex', flexDirection: 'column', gap: '4px' },
    headerRow: { display: 'flex', alignItems: 'flex-start', gap: '12px' },
    headerRowCopy: { flex: 1, minWidth: 0 },
    subtitle: { color: tokens.colorNeutralForeground2 },
    action: { flexShrink: 0 },
});

/**
 * One titled block of content inside a {@link ContainerMain}.
 *
 * With {@link ContainerSectionProps.focusOnMount} it moves focus to its own heading when it
 * mounts, which is what makes a step change land on the new content instead of dropping focus to
 * `<body>` (WCAG 2.4.3). It deliberately does *not* fire on the `Container`'s first render:
 * arriving at a surface is not a navigation.
 */
export const ContainerSection = ({
    title,
    subtitle,
    action,
    focusOnMount,
    headingLevel = 2,
    children,
    className,
    ...rest
}: ContainerSectionProps): JSX.Element => {
    const styles = useStyles();
    const headingId = useId('container-section-heading-');
    const headingRef = useRef<HTMLSpanElement>(null);
    const { isFirstRenderRef } = useContainerContext();

    useEffect(() => {
        if (!focusOnMount || isFirstRenderRef.current) {
            return;
        }
        const heading = headingRef.current;
        if (heading) {
            // A heading is not focusable by default; -1 makes it programmatically focusable
            // without adding it to the tab order.
            heading.tabIndex = -1;
            heading.focus();
        }
        // Mount only: a step change unmounts this section and mounts the next one.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const hasHeader = title !== undefined || subtitle !== undefined || action !== undefined;
    const headerBlock = hasHeader && (
        <div className={styles.header}>
            {title !== undefined && (
                <Text
                    id={headingId}
                    ref={headingRef}
                    as={headingLevel === 2 ? 'h2' : 'h3'}
                    size={500}
                    weight="semibold"
                >
                    {title}
                </Text>
            )}
            {subtitle !== undefined && <Text className={styles.subtitle}>{subtitle}</Text>}
        </div>
    );

    return (
        <section
            className={mergeClasses(styles.section, className)}
            aria-labelledby={title !== undefined ? headingId : undefined}
            {...rest}
        >
            {action !== undefined ? (
                <div className={styles.headerRow}>
                    <div className={styles.headerRowCopy}>{headerBlock}</div>
                    <div className={styles.action}>{action}</div>
                </div>
            ) : (
                headerBlock
            )}
            {children}
        </section>
    );
};
