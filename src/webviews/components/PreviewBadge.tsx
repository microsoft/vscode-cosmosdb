/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, makeStyles, mergeClasses } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useLayoutEffect, useRef } from 'react';
import { ThemedTooltip as Tooltip } from '../common/ThemedTooltip';

const useStyles = makeStyles({
    badge: {
        pointerEvents: 'auto',
        marginTop: '8px',
        marginRight: '8px',
        cursor: 'default',
        height: '32px',
        paddingLeft: '20px',
        paddingRight: '20px',
        borderRadius: '6px',
        fontWeight: 600,
        backgroundColor: 'var(--vscode-editorWidget-background)',
        color: 'var(--vscode-foreground)',
        border: '1px solid var(--vscode-panel-border)',
        boxShadow: '0 2px 8px var(--vscode-widget-shadow)',
        '&:focus-visible': {
            outline: '2px solid var(--vscode-focusBorder)',
            outlineOffset: '1px',
        },
    },
});

export const PreviewBadge = ({
    className,
    onWidthChange,
}: {
    className?: string;
    onWidthChange?: (width: number) => void;
}) => {
    const styles = useStyles();
    const badgeRef = useRef<HTMLDivElement>(null);
    const label = l10n.t('Preview');
    const description = l10n.t('Preview: features and behavior may change. Use with care.');

    useLayoutEffect(() => {
        const badge = badgeRef.current;
        if (!badge || !onWidthChange) {
            return;
        }
        const measure = () => onWidthChange(badge.getBoundingClientRect().width);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(badge);
        return () => observer.disconnect();
    }, [onWidthChange]);

    return (
        <Tooltip content={description} relationship="description">
            <Badge
                ref={badgeRef}
                appearance="outline"
                color="informative"
                className={mergeClasses(styles.badge, className)}
                tabIndex={0}
                aria-label={label}
            >
                <span aria-hidden="true">{label}</span>
            </Badge>
        </Tooltip>
    );
};
