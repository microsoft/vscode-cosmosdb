/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { markerBrandKey, type MarkerComponent } from '../utils/markerChildren.js';
import { type StepListItemProps } from './StepList.types.js';

export const stepListItemBrand: unique symbol = Symbol.for('vscode-ext-webview-fluentui.StepListItem');

/**
 * One step of a {@link StepList}.
 *
 * A declarative marker: it renders nothing on its own. `StepList` reads its props, because the
 * dividers between steps and the overflow menu both need the whole sequence, not one item at a
 * time.
 */
export const StepListItem: ((props: StepListItemProps) => null) & MarkerComponent = Object.assign(
    (_props: StepListItemProps): null => null,
    { [markerBrandKey]: stepListItemBrand, displayName: 'StepListItem' },
);
