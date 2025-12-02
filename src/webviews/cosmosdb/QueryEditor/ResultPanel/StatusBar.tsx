/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Label, MenuItem } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useEffect, useRef, useState } from 'react';
import { type ToolbarOverflowItemProps } from '../../../common/ToolbarOverflow/ToolbarOverflowItem';
import { Timer } from '../../../Timer';
import { useQueryEditorState } from '../state/QueryEditorContext';

export const StatusBar = (props: ToolbarOverflowItemProps<HTMLDivElement>) => {
    const state = useQueryEditorState();

    const [time, setTime] = useState(0);
    const { ref, type } = props;
    const intervalRef = useRef<NodeJS.Timeout | undefined>(undefined);
    const startTimeRef = useRef<number>(0);

    const recordRange = state.currentExecutionId
        ? state.pageSize === -1
            ? state.currentQueryResult?.documents?.length
                ? `0 - ${state.currentQueryResult?.documents?.length}`
                : l10n.t('All')
            : `${(state.pageNumber - 1) * state.pageSize} - ${state.pageNumber * state.pageSize}`
        : `0 - 0`;

    useEffect(() => {
        // Clear any existing interval
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = undefined;
        }

        if (state.isExecuting) {
            startTimeRef.current = Date.now();
            intervalRef.current = setInterval(() => {
                setTime(Date.now() - startTimeRef.current);
            }, 10);
        } else {
            startTimeRef.current = 0;
            // Use setTimeout to avoid synchronous setState in effect
            setTimeout(() => setTime(0), 0);
        }

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = undefined;
            }
        };
    }, [state.isExecuting]);

    if (type === 'button') {
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
};
