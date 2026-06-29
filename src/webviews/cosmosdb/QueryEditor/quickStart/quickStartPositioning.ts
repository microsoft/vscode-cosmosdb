/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type QuickStartTipPosition } from '../../../../utils/quickStart/quickStartTypes';

/**
 * Fluent positioning descriptor: a `position` (side) plus an `align` along that
 * side. Mirrors the subset of `@fluentui/react-positioning` we use.
 */
export interface QuickStartPositioning {
    position: 'above' | 'below' | 'before' | 'after';
    align: 'start' | 'center' | 'end';
}

/**
 * Translates a tip's compact `position` shorthand into the `{ position, align }`
 * object Fluent's `Popover` expects. Pure — unit-tested in isolation.
 *
 * Defaults to `{ below, center }` when no position is given.
 */
export function toFluentPositioning(position?: QuickStartTipPosition): QuickStartPositioning {
    switch (position) {
        case 'above':
            return { position: 'above', align: 'center' };
        case 'above-start':
            return { position: 'above', align: 'start' };
        case 'above-end':
            return { position: 'above', align: 'end' };
        case 'below-start':
            return { position: 'below', align: 'start' };
        case 'below-end':
            return { position: 'below', align: 'end' };
        case 'before':
            return { position: 'before', align: 'center' };
        case 'after':
            return { position: 'after', align: 'center' };
        case 'below':
        default:
            return { position: 'below', align: 'center' };
    }
}
