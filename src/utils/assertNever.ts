/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Exhaustiveness guard for discriminated union switches.
 *
 * Place in the `default` branch of a `switch` statement over a discriminated
 * union. If every variant is handled, TypeScript narrows the value to `never`
 * and the call is eliminated at compile time. If a new variant is added but
 * not handled, the compiler reports a type error because the value is no
 * longer assignable to `never`.
 *
 * @example
 * ```ts
 * switch (event.type) {
 *     case 'a': …; break;
 *     case 'b': …; break;
 *     default: assertNever(event);
 * }
 * ```
 */
export function assertNever(value: never): never {
    throw new Error(`Unexpected value: ${value}`);
}
