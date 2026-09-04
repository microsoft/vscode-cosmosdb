/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { markerBrandKey, type MarkerComponent } from '../utils/markerChildren.js';
import { type WizardStepProps } from './Wizard.types.js';

export const wizardStepBrand: unique symbol = Symbol.for('vscode-ext-webview-fluentui.WizardStep');

/**
 * One step of a {@link Wizard}: its label, its heading and its content, declared together.
 *
 * A declarative marker: it renders nothing on its own. `Wizard` reads its props, because the step
 * indicator needs every step while only one step's content is rendered.
 */
export const WizardStep: ((props: WizardStepProps) => null) & MarkerComponent = Object.assign(
    (_props: WizardStepProps): null => null,
    { [markerBrandKey]: wizardStepBrand, displayName: 'WizardStep' },
);
