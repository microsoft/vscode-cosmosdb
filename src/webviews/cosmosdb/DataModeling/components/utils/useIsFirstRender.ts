/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type RefObject, useEffect, useRef } from 'react';

/**
 * A ref that reads `true` for the duration of the first render pass and `false` afterwards.
 *
 * A ref rather than state, deliberately: flipping it must not re-render, and descendants have to
 * be able to read it from their own mount effects. React runs child effects before parent effects,
 * so a descendant mounting together with the owner still sees `true`.
 */
export const useIsFirstRender = (): RefObject<boolean> => {
    const isFirstRenderRef = useRef(true);

    useEffect(() => {
        isFirstRenderRef.current = false;
    }, []);

    return isFirstRenderRef;
};
