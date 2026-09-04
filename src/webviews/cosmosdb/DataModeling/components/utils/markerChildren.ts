/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

/**
 * Some components take *declarative markers* as children: elements that render nothing themselves
 * and exist so the parent can read their props (`StepListItem`, `WizardStep`).
 *
 * Identifying them with `child.type === Marker` breaks under duplicate module instances (two
 * copies of the package in a consumer's tree, or a fast-refresh during development), and it fails
 * silently, by rendering nothing. A `Symbol.for` brand survives both, because the symbol registry
 * is global to the realm.
 */
export const markerBrandKey = Symbol.for('vscode-ext-webview-fluentui.marker');

export interface MarkerComponent {
    readonly [markerBrandKey]: symbol;
}

/** Collects the children carrying `brand`, in order. Anything else, `false` and `null` included, is dropped. */
export const collectMarkerChildren = <P>(children: ReactNode, brand: symbol): ReactElement<P>[] =>
    Children.toArray(children).filter((child): child is ReactElement<P> => {
        if (!isValidElement(child)) {
            return false;
        }
        const type = child.type as Partial<MarkerComponent>;
        return typeof type === 'function' && type[markerBrandKey] === brand;
    });
