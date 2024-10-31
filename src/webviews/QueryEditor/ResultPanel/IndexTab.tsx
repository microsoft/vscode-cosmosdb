/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useQueryEditorState } from '../state/QueryEditorContext';

export const IndexTab = () => {
    const state = useQueryEditorState();

    const indexMetrics = state.currentQueryResult?.indexMetrics;

    return (
        <div>
            <pre>{indexMetrics}</pre>
        </div>
    );
};
