/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ReactNode } from 'react';
import { type ContainerNavPosition } from '../Container/Container.types.js';

export interface WizardProps {
    /** The `value` of the step being shown. */
    readonly activeStep: string;
    /** Called when a navigable step is activated. `Wizard` never navigates itself. */
    readonly onStepChange: (value: string) => void;
    /** @default 'top' */
    readonly navPosition?: ContainerNavPosition;
    /** Suppresses back-navigation: work is in flight, or the outcome is already committed. */
    readonly stepsLocked?: boolean;
    /**
     * Pin the header and step indicator as a fixed top band and scroll only the step body, instead
     * of the whole surface scrolling under a pinned footer. Applies to the `'top'` nav layout only.
     * @default false
     */
    readonly stickyChrome?: boolean;
    /** Accessible name of the step indicator. */
    readonly stepsAriaLabel: string;
    /** Accessible name of the step indicator's "…" overflow button. Defaults to English. */
    readonly overflowAriaLabel?: (count: number) => string;
    /** A `ContainerHeader`. Scrolls with the content. */
    readonly header?: ReactNode;
    /** A `ContainerFooter`. Pinned, and elevates itself while the content overflows. */
    readonly footer?: ReactNode;
    /** `WizardStep` children, in order. Anything else, a fragment of them included, is ignored. */
    readonly children: ReactNode;
}

export interface WizardStepProps {
    /** Matched against {@link WizardProps.activeStep}, and reported by `onStepChange`. */
    readonly value: string;
    /** Shown in the step indicator. */
    readonly label: ReactNode;
    /** The section heading. Defaults to {@link label}. */
    readonly title?: ReactNode;
    /** One line of guidance under the heading. */
    readonly subtitle?: ReactNode;
    /** End-aligned trailing content on the heading row. */
    readonly action?: ReactNode;
    /** Overrides the derived completed state. */
    readonly completed?: boolean;
    /** Overrides the derived navigable state. */
    readonly navigable?: boolean;
    /** The step's content. Rendered only while this is the active step. */
    readonly children?: ReactNode;
}
