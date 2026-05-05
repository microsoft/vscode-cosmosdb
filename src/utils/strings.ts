/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * General-purpose string utilities: serialisation, truncation, and padding.
 */

/**
 * Converts any value to a human-readable string.
 *
 * Handles all JavaScript value types predictably:
 * - `null`      → `"null"`
 * - `undefined` → `"undefined"`
 * - Primitives  → `String(value)` (numbers, booleans, bigints, symbols)
 * - `Error`     → `error.message`
 * - Objects/arrays → `JSON.stringify(value, null, 2)` (pretty-printed)
 * - Objects with circular references or non-serialisable values
 *   → constructor name (e.g. `"[Map]"`) or `Object.prototype.toString` result
 *
 * This is the canonical display serialiser for table cells and tree nodes —
 * use it at **render time**, not when storing data into `TableRecord`.
 *
 * @param value Any JavaScript value
 * @returns A human-readable string representation
 */
export const toStringUniversal = (value: unknown): string => {
    // Handle null/undefined explicitly
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';

    // Handle primitives (number, boolean, bigint, symbol, string)
    if (typeof value !== 'object') {
        // oxlint-disable-next-line typescript/no-base-to-string
        return String(value);
    }

    // Handle Error objects — prefer the message over the full JSON
    if (value instanceof Error) {
        return value.message || value.toString();
    }

    // Try JSON.stringify for objects/arrays
    try {
        return JSON.stringify(value, null, 2); // Pretty-print with indentation
    } catch {
        // Circular reference or other JSON error — fall back to type info
        const typeString = Object.prototype.toString.call(value);

        try {
            const constructor = (value as Record<string, unknown>)?.constructor?.name;
            if (constructor && constructor !== 'Object') {
                return `[${constructor}]`;
            }
        } catch {
            // Ignore — proceed to typeString fallback
        }

        return typeString; // e.g. "[object Map]", "[object Date]"
    }
};

/**
 * Truncates a string if it exceeds the specified maximum length.
 *
 * @param value The string to truncate
 * @param maxLength Maximum length of the resulting string (including suffix)
 * @param suffix Suffix to append to truncated strings (default: "…")
 * @returns The truncated string with suffix if truncated, or original string
 */
export const truncateString = (value: string, maxLength: number, suffix = '…'): string => {
    if (!value) {
        return '';
    }

    if (value.length <= maxLength) {
        return value;
    }

    return value.substring(0, maxLength - suffix.length) + suffix;
};

/**
 * Creates a zero-padded string representation of an index so that all indices
 * in a collection sort correctly in lexicographic order.
 *
 * Examples (array of 1000 items):
 * - `leftPadIndex(0, 1000)`   → `"000"`
 * - `leftPadIndex(42, 1000)`  → `"042"`
 * - `leftPadIndex(999, 1000)` → `"999"`
 *
 * @param index     The index to pad
 * @param array     The array whose length determines the padding width,
 *                  or a plain number to use directly as the length
 * @param padChar   Padding character (default: `'0'`)
 * @returns Zero-padded index string
 */
export function leftPadIndex(index: number, array: unknown[] | number, padChar: string = '0'): string {
    const arrayLength = Array.isArray(array) ? array.length : array;
    const maxDigits = Math.floor(Math.log10(arrayLength - 1) + 1);
    return String(index).padStart(maxDigits, padChar);
}
