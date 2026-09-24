/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from '@fluentui/react-components';

const useStyles = makeStyles({
    track: {
        height: '10px',
        width: '100%',
        margin: '8px 0',
        backgroundColor: 'var(--vscode-editorWidget-background)',
        border: '1px solid var(--vscode-panel-border)',
        boxSizing: 'border-box',
    },
    fill: {
        height: '100%',
        backgroundColor: 'var(--vscode-charts-blue, var(--vscode-textLink-foreground))',
        borderRight: '1px solid var(--vscode-contrastBorder, transparent)',
        boxSizing: 'border-box',
    },
});

/** Visual companion to the adjacent resource/partition label and measured value. */
export function OverviewBar({
    value,
    maximum,
    warning = false,
}: {
    value: number;
    maximum: number;
    warning?: boolean;
}) {
    const styles = useStyles();
    return (
        <div className={styles.track} aria-hidden="true">
            <div
                className={styles.fill}
                style={{
                    width: `${maximum > 0 ? Math.min(100, (value / maximum) * 100) : 0}%`,
                    ...(warning ? { backgroundColor: 'var(--vscode-charts-yellow)' } : {}),
                }}
            />
        </div>
    );
}
