/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The step-list state both wizard surfaces in this repository arrived at independently, extracted
 * so it lives in one place instead of two. A `WizardStep` overrides either one per step.
 */

/**
 * The first step opens pre-satisfied, because there is nothing on it to complete, and the last
 * step shows as completed while it is the one being shown, because reaching it *is* the completion.
 */
export const defaultCompleted = (index: number, activeIndex: number, count: number): boolean =>
    index === 0 || index < activeIndex || (index === count - 1 && index === activeIndex);

/** Only backwards, and not while work is in flight or the outcome is already committed. */
export const defaultNavigable = (index: number, activeIndex: number, locked: boolean): boolean =>
    index < activeIndex && !locked;
