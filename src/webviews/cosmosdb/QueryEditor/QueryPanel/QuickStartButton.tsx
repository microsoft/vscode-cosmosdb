/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MenuItem, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { LightbulbRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback } from 'react';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { requestQuickStartReplay } from '../quickStart/quickStartReplay';

const lightbulbIcon = <LightbulbRegular />;

/**
 * Toolbar action that replays the Quick Start tour on demand. Replaying never
 * clears the user's persisted "seen" state. The parent toolbar hides this when
 * the feature is disabled via the `cosmosDB.quickStart.enabled` setting.
 */
export const QuickStartButton = ({ ref, type }: ToolbarOverflowItemProps<HTMLButtonElement>) => {
    const onReplay = useCallback(() => requestQuickStartReplay(), []);

    if (type === 'button') {
        return (
            <Tooltip
                content={l10n.t('Replay the Quick Start tips')}
                relationship="label"
                appearance="inverted"
                withArrow
            >
                <ToolbarButton ref={ref} icon={lightbulbIcon} onClick={onReplay} />
            </Tooltip>
        );
    }

    return (
        <MenuItem icon={lightbulbIcon} onClick={onReplay}>
            {l10n.t('Quick Start')}
        </MenuItem>
    );
};
