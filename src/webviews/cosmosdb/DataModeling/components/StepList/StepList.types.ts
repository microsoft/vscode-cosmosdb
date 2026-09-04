/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ReactNode, type SyntheticEvent } from 'react';

export interface StepListItemSelectData {
    /** The {@link StepListItemProps.value} of the activated step. */
    readonly value: string;
}

export interface StepListProps {
    /**
     * Render the steps as a rail beside the content rather than a row above it.
     *
     * **Not implemented yet.** The prop and the surrounding layout accept it so the vertical
     * rendering lands as an additive change; today it renders horizontally either way.
     */
    readonly vertical?: boolean;
    /** The step currently being shown. Controlled only: a wizard always drives its own navigation. */
    readonly selectedValue: string;
    /** Called when a navigable step is activated, inline or from the overflow menu. */
    readonly onStepSelect: (event: SyntheticEvent, data: StepListItemSelectData) => void;
    /** Accessible name of the navigation landmark. */
    readonly ariaLabel: string;
    /**
     * Accessible name of the "…" overflow button, given the number of hidden steps. Defaults to
     * English; pass a localized builder if the consumer ships translations.
     */
    readonly overflowAriaLabel?: (count: number) => string;
    /** `StepListItem` children, in wizard order. Anything else is ignored. */
    readonly children: ReactNode;
}

export interface StepListItemProps {
    /** Matched against {@link StepListProps.selectedValue}, and reported by `onStepSelect`. */
    readonly value: string;
    /** Show the step as satisfied: a check glyph, and a weight that does not change when it stops being current. */
    readonly completed?: boolean;
    /** Allow going back to this step. A non-navigable step stays focusable, so it is still readable by a screen reader. */
    readonly navigable?: boolean;
    /** The step's label. */
    readonly children: ReactNode;
}
