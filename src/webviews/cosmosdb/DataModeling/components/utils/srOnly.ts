/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from '@fluentui/react-components';

/**
 * Visually hidden, still exposed to assistive technology. The `clip` rectangle rather than
 * `display: none` is what keeps the text readable by a screen reader.
 *
 * `position: absolute` needs a positioned ancestor to stay out of the flow of its siblings;
 * `Container` provides one.
 */
export const useSrOnlyStyles = makeStyles({
    srOnly: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
    },
});
