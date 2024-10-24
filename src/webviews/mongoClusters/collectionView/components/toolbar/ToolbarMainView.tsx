/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { ArrowClockwiseRegular, PlayRegular } from '@fluentui/react-icons';
import { useContext, type JSX } from 'react';
import { CollectionViewContext } from '../../collectionViewContext';
import { ToolbarDividerTransparent } from './ToolbarDividerTransparent';

interface ToolbarMainViewProps {
    setting: string;
}

export const ToolbarMainView = ({ setting: string }: ToolbarMainViewProps): JSX.Element => {
    const [currentContext] = useContext(CollectionViewContext);

    return (
        <Toolbar size="small">
            <Tooltip content="Execute the current find query" relationship="description" withArrow>
                <ToolbarButton
                    aria-label="Execute the find query"
                    disabled={currentContext.isLoading}
                    icon={<PlayRegular />}
                    appearance="primary"
                >
                    Find Query
                </ToolbarButton>
            </Tooltip>

            <ToolbarDividerTransparent />

            <Tooltip content="Refresh current view" relationship="description" withArrow>
                <ToolbarButton aria-label="Refresh current view" icon={<ArrowClockwiseRegular />}>
                    Refresh
                </ToolbarButton>
            </Tooltip>
        </Toolbar>
    );
};
