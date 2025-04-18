/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

/**
 * Retrieves a property by name from an object and checks that it's not null and not undefined.  It is strongly typed
 * for the property and will give a compile error if the given name is not a property of the source.
 */
export function nonNullProp<TSource, TKey extends keyof TSource>(
    source: TSource,
    name: TKey,
    message?: string,
): NonNullable<TSource[TKey]> {
    const value: NonNullable<TSource[TKey]> = <NonNullable<TSource[TKey]>>source[name];
    if (message) {
        return nonNullValue(value, `${<string>name}, ${message}`);
    }
    return nonNullValue(value, <string>name);
}

/**
 * Validates that a given value is not null and not undefined.
 */
export function nonNullValue<T>(value: T | undefined | null, propertyNameOrMessage?: string): T {
    if (value === undefined || value === null) {
        throw new Error(
            l10n.t('Internal error: Expected value to be neither null nor undefined') +
                (propertyNameOrMessage ? `: ${propertyNameOrMessage}` : ''),
        );
    }

    return value;
}

/**
 * Validates that a given string is not null, undefined, nor empty
 */
export function nonNullOrEmptyValue(value: string | undefined, propertyNameOrMessage?: string): string {
    if (!value) {
        throw new Error(
            l10n.t('Internal error: Expected value to be neither null, undefined, nor empty') +
                (propertyNameOrMessage ? `: ${propertyNameOrMessage}` : ''),
        );
    }

    return value;
}
