/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, type RefObject, useContext } from 'react';

/**
 * State shared between the `Container` family members. Internal: not exported from the package.
 *
 * It is what earns the family. `ContainerBody` measures its own overflow and publishes it here;
 * `ContainerFooter` reads it and elevates itself. `Container` records whether it has painted once,
 * so `ContainerSection focusOnMount` can skip the first render (moving focus on arrival would
 * fight the consumer's own initial focus, and there is nothing "new" to announce yet).
 */
export interface ContainerContextValue {
    /**
     * `true` until the `Container`'s own mount effect has run. Child effects run before parent
     * effects, so a section mounting with the container still reads `true`, while a section
     * mounting later reads `false`.
     */
    readonly isFirstRenderRef: RefObject<boolean>;
    /** `true` while the body has content below the fold. */
    readonly overflowing: boolean;
    readonly setOverflowing: (overflowing: boolean) => void;
}

const noopContext: ContainerContextValue = {
    isFirstRenderRef: { current: false },
    overflowing: false,
    setOverflowing: () => undefined,
};

export const ContainerContext = createContext<ContainerContextValue>(noopContext);

/**
 * Reads the surrounding `Container`'s shared state. Members used outside a `Container` degrade to
 * a static, never-elevated, always-focus-on-mount reading rather than throwing: a consumer who
 * renders a `ContainerSection` on its own should get a section, not a crash.
 */
export const useContainerContext = (): ContainerContextValue => useContext(ContainerContext);
