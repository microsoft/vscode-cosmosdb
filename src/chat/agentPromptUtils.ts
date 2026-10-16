/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Delimiters that fence a block of untrusted, user-supplied text inside an agent
 * prompt. Everything between them is data (the user's request), never instructions.
 */
export const USER_DATA_START = 'BEGIN_USER_DATA';
export const USER_DATA_END = 'END_USER_DATA';

/**
 * Normalizes line endings and removes embedded delimiters before fencing untrusted text as data.
 * This prevents input from forging an end marker in the surrounding agent instruction template.
 */
export function wrapUserDataForAgent(text: string): string {
    let neutralized = text.replace(/\r\n?/g, '\n');
    // Repeat until stable: removing a marker can join fragments that form another marker.
    const marker = new RegExp(`${USER_DATA_START}|${USER_DATA_END}`, 'gi');
    let previous: string;
    do {
        previous = neutralized;
        neutralized = neutralized.replace(marker, '');
    } while (neutralized !== previous);

    return `${USER_DATA_START}\n${neutralized}\n${USER_DATA_END}`;
}
