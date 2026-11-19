/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    makeStyles,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    MessageBarTitle,
    tokens,
} from '@fluentui/react-components';
import { ChevronDown16Regular, ChevronRight16Regular } from '@fluentui/react-icons';
import { type ReactNode, useId, useState } from 'react';

const useStyles = makeStyles({
    root: {
        marginBottom: tokens.spacingVerticalS,
    },
    toggle: {
        minHeight: 0,
        paddingLeft: 0,
        paddingRight: 0,
        justifyContent: 'flex-start',
        textAlign: 'left',
        whiteSpace: 'normal',
    },
    panel: {
        paddingTop: tokens.spacingVerticalS,
    },
    actions: {
        alignItems: 'center',
        flexWrap: 'wrap',
        rowGap: tokens.spacingVerticalS,
    },
});

export const CollapsibleNotice = ({
    title,
    intent,
    children,
    actions,
}: {
    title: string;
    intent: 'info' | 'warning';
    children: ReactNode;
    actions: ReactNode;
}) => {
    const styles = useStyles();
    const [expanded, setExpanded] = useState(false);
    const detailsId = useId();
    return (
        <MessageBar
            className={styles.root}
            intent={intent}
            layout="multiline"
            politeness="polite"
            icon={{ 'aria-hidden': true }}
        >
            <MessageBarBody>
                <Button
                    className={styles.toggle}
                    appearance="transparent"
                    size="small"
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    onClick={() => setExpanded((previous) => !previous)}
                    icon={expanded ? <ChevronDown16Regular aria-hidden /> : <ChevronRight16Regular aria-hidden />}
                >
                    <MessageBarTitle>{title}</MessageBarTitle>
                </Button>
                <div id={detailsId} className={styles.panel} hidden={!expanded}>
                    {children}
                </div>
            </MessageBarBody>
            <MessageBarActions className={styles.actions}>{actions}</MessageBarActions>
        </MessageBar>
    );
};
