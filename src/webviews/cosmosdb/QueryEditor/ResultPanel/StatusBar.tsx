/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ForwardedRef, forwardRef, useEffect, useState } from 'react';
import { useQueryEditorState } from '../state/QueryEditorContext';
import * as l10n from '@vscode/l10n';
import { Timer } from '../../../Timer';
import { Label, MenuItem } from '@fluentui/react-components';
import  { type ToolbarOverflowItemProps } from '../OverflowToolbarItem';

export const StatusBar = forwardRef(function StatusBar(props: ToolbarOverflowItemProps, ref: ForwardedRef<HTMLDivElement>)  {
    const state = useQueryEditorState();

    const [time, setTime] = useState(0);

    const recordRange = state.currentExecutionId
        ? state.pageSize === -1
            ? state.currentQueryResult?.documents?.length
                ? `0 - ${state.currentQueryResult?.documents?.length}`
                : l10n.t('All')
            : `${(state.pageNumber - 1) * state.pageSize} - ${state.pageNumber * state.pageSize}`
        : `0 - 0`;

    useEffect(() => {
        let interval: NodeJS.Timeout | undefined = undefined;
        let now: number;

        if (state.isExecuting) {
            now = Date.now();
            interval = setInterval(() => {
                setTime(Date.now() - now);
            }, 10);
        } else {
            now = 0;
            setTime(0);
            clearInterval(interval);
        }
        return () => clearInterval(interval);
    }, [state.isExecuting]);

    if (props.type === 'button') {
        return (
            <div ref={ref} style={{ minWidth: '100px', maxWidth: '100px', textAlign: 'center' }}>
                {state.isExecuting && <Timer time={time} />}
                {!state.isExecuting && <Label weight="semibold">{recordRange}</Label>}
            </div>
        );
    }

    return (
        <MenuItem>
            {state.isExecuting && <Timer time={time} />}
            {!state.isExecuting && <Label weight="semibold">{recordRange}</Label>}
        </MenuItem>
    );
});
