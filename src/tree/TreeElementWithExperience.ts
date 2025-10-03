/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../AzureDBExperiences';

/**
 * It's currently being kept separately from the TreeElement as we need to discuss it with the team,
 * as we're working on an overlapping feature in parallel, keeping the 'experience' property in a separate
 * interface simplifies parallel development and can still be easily merged once ready for it.
 */
export type TreeElementWithExperience = {
    experience: Experience;
};

/**
 * Type guard function to check if a given node is a `TreeElementWithExperience`.
 *
 * @param node - The node to check.
 * @returns `true` if the node is an object and has an `experience` property, otherwise `false`.
 */
export function isTreeElementWithExperience(node: unknown): node is TreeElementWithExperience {
    return typeof node === 'object' && node !== null && 'experience' in node;
}
