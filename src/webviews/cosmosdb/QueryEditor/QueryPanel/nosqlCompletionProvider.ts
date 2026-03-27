/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Monaco CompletionItemProvider for CosmosDB NoSQL query language.
 *
 * Provides context-aware autocompletion:
 * - SQL keywords (SELECT, FROM, WHERE, ORDER BY, etc.)
 * - Built-in functions with signatures (aggregate, string, math, type-checking, etc.)
 * - Schema-driven property suggestions after dot notation (e.g. `c.` → property names)
 * - Lightweight alias tracking from the FROM clause
 *
 * Reference: https://learn.microsoft.com/azure/cosmos-db/nosql/query/
 */

// eslint-disable-next-line import/no-internal-modules
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { type JSONSchema } from '../../../../utils/json/JSONSchema';
import { NOSQL_LANGUAGE_ID } from './nosqlLanguage';

// ─── Keyword definitions ───────────────────────────────────────────────────────

const NOSQL_KEYWORDS = [
    'SELECT',
    'DISTINCT',
    'TOP',
    'FROM',
    'WHERE',
    'ORDER BY',
    'GROUP BY',
    'HAVING',
    'OFFSET',
    'LIMIT',
    'JOIN',
    'IN',
    'AS',
    'VALUE',
    'EXISTS',
    'BETWEEN',
    'LIKE',
    'AND',
    'OR',
    'NOT',
    'ASC',
    'DESC',
    'NULL',
    'TRUE',
    'FALSE',
    'UNDEFINED',
    'ARRAY',
    'UDF',
];

// ─── Built-in function definitions with signatures ─────────────────────────────

interface FunctionInfo {
    name: string;
    signature: string;
    description: string;
}

const NOSQL_FUNCTIONS: FunctionInfo[] = [
    // Aggregate functions
    { name: 'AVG', signature: 'AVG(expr)', description: 'Returns the average of the values.' },
    { name: 'COUNT', signature: 'COUNT(expr)', description: 'Returns the number of items.' },
    { name: 'MAX', signature: 'MAX(expr)', description: 'Returns the maximum value.' },
    { name: 'MIN', signature: 'MIN(expr)', description: 'Returns the minimum value.' },
    { name: 'SUM', signature: 'SUM(expr)', description: 'Returns the sum of all values.' },

    // Mathematical functions
    { name: 'ABS', signature: 'ABS(expr)', description: 'Returns the absolute value.' },
    { name: 'ACOS', signature: 'ACOS(expr)', description: 'Returns the arccosine in radians.' },
    { name: 'ASIN', signature: 'ASIN(expr)', description: 'Returns the arcsine in radians.' },
    { name: 'ATAN', signature: 'ATAN(expr)', description: 'Returns the arctangent in radians.' },
    { name: 'ATN2', signature: 'ATN2(y, x)', description: 'Returns the arctangent of y/x in radians.' },
    { name: 'CEILING', signature: 'CEILING(expr)', description: 'Returns the smallest integer >= value.' },
    { name: 'COS', signature: 'COS(expr)', description: 'Returns the cosine in radians.' },
    { name: 'COT', signature: 'COT(expr)', description: 'Returns the cotangent in radians.' },
    { name: 'DEGREES', signature: 'DEGREES(radians)', description: 'Converts radians to degrees.' },
    { name: 'EXP', signature: 'EXP(expr)', description: 'Returns e raised to the specified power.' },
    { name: 'FLOOR', signature: 'FLOOR(expr)', description: 'Returns the largest integer <= value.' },
    { name: 'LOG', signature: 'LOG(expr [, base])', description: 'Returns the natural logarithm.' },
    { name: 'LOG10', signature: 'LOG10(expr)', description: 'Returns the base-10 logarithm.' },
    { name: 'PI', signature: 'PI()', description: 'Returns the constant value of PI.' },
    { name: 'POWER', signature: 'POWER(base, exponent)', description: 'Returns base raised to exponent.' },
    { name: 'RADIANS', signature: 'RADIANS(degrees)', description: 'Converts degrees to radians.' },
    { name: 'RAND', signature: 'RAND()', description: 'Returns a random number between 0 and 1.' },
    { name: 'ROUND', signature: 'ROUND(expr [, length])', description: 'Rounds to the specified length.' },
    { name: 'SIGN', signature: 'SIGN(expr)', description: 'Returns -1, 0, or 1 for the sign.' },
    { name: 'SIN', signature: 'SIN(expr)', description: 'Returns the sine in radians.' },
    { name: 'SQRT', signature: 'SQRT(expr)', description: 'Returns the square root.' },
    { name: 'SQUARE', signature: 'SQUARE(expr)', description: 'Returns the square of the value.' },
    { name: 'TAN', signature: 'TAN(expr)', description: 'Returns the tangent in radians.' },
    { name: 'TRUNC', signature: 'TRUNC(expr)', description: 'Truncates to the nearest integer.' },

    // Integer math functions
    { name: 'IntAdd', signature: 'IntAdd(a, b)', description: 'Returns the sum as a 64-bit integer.' },
    { name: 'IntBitAnd', signature: 'IntBitAnd(a, b)', description: 'Bitwise AND.' },
    {
        name: 'IntBitLeftShift',
        signature: 'IntBitLeftShift(value, shift)',
        description: 'Bitwise left shift.',
    },
    { name: 'IntBitNot', signature: 'IntBitNot(value)', description: 'Bitwise NOT.' },
    { name: 'IntBitOr', signature: 'IntBitOr(a, b)', description: 'Bitwise OR.' },
    {
        name: 'IntBitRightShift',
        signature: 'IntBitRightShift(value, shift)',
        description: 'Bitwise right shift.',
    },
    { name: 'IntBitXor', signature: 'IntBitXor(a, b)', description: 'Bitwise XOR.' },
    { name: 'IntDiv', signature: 'IntDiv(a, b)', description: 'Integer division.' },
    { name: 'IntMod', signature: 'IntMod(a, b)', description: 'Integer modulo.' },
    { name: 'IntMul', signature: 'IntMul(a, b)', description: 'Integer multiplication.' },
    { name: 'IntSub', signature: 'IntSub(a, b)', description: 'Integer subtraction.' },
    {
        name: 'NumberBin',
        signature: 'NumberBin(value [, binSize])',
        description: 'Rounds down to a multiple of bin size.',
    },

    // Type checking functions
    { name: 'IS_ARRAY', signature: 'IS_ARRAY(expr)', description: 'Returns true if the value is an array.' },
    { name: 'IS_BOOL', signature: 'IS_BOOL(expr)', description: 'Returns true if the value is a boolean.' },
    {
        name: 'IS_DEFINED',
        signature: 'IS_DEFINED(expr)',
        description: 'Returns true if the property is defined.',
    },
    {
        name: 'IS_FINITE_NUMBER',
        signature: 'IS_FINITE_NUMBER(expr)',
        description: 'Returns true if the value is a finite number.',
    },
    {
        name: 'IS_INTEGER',
        signature: 'IS_INTEGER(expr)',
        description: 'Returns true if the value is an integer.',
    },
    { name: 'IS_NULL', signature: 'IS_NULL(expr)', description: 'Returns true if the value is null.' },
    { name: 'IS_NUMBER', signature: 'IS_NUMBER(expr)', description: 'Returns true if the value is a number.' },
    {
        name: 'IS_OBJECT',
        signature: 'IS_OBJECT(expr)',
        description: 'Returns true if the value is an object.',
    },
    {
        name: 'IS_PRIMITIVE',
        signature: 'IS_PRIMITIVE(expr)',
        description: 'Returns true if the value is a primitive (string, number, boolean, or null).',
    },
    {
        name: 'IS_STRING',
        signature: 'IS_STRING(expr)',
        description: 'Returns true if the value is a string.',
    },

    // String functions
    { name: 'CONCAT', signature: 'CONCAT(str1, str2 [, ...])', description: 'Concatenates strings.' },
    {
        name: 'CONTAINS',
        signature: 'CONTAINS(str, substr [, ignoreCase])',
        description: 'Returns true if the string contains the substring.',
    },
    {
        name: 'ENDSWITH',
        signature: 'ENDSWITH(str, suffix [, ignoreCase])',
        description: 'Returns true if the string ends with the suffix.',
    },
    {
        name: 'INDEX_OF',
        signature: 'INDEX_OF(str, substr [, startIndex])',
        description: 'Returns the starting position of the first occurrence.',
    },
    {
        name: 'LEFT',
        signature: 'LEFT(str, length)',
        description: 'Returns the left part of a string with the specified number of characters.',
    },
    { name: 'LENGTH', signature: 'LENGTH(str)', description: 'Returns the number of characters.' },
    { name: 'LOWER', signature: 'LOWER(str)', description: 'Returns the string in lowercase.' },
    { name: 'LTRIM', signature: 'LTRIM(str)', description: 'Removes leading whitespace.' },
    {
        name: 'REGEXMATCH',
        signature: 'REGEXMATCH(str, pattern [, modifiers])',
        description: 'Returns true if the string matches the regex.',
    },
    {
        name: 'REPLACE',
        signature: 'REPLACE(str, find, replacement)',
        description: 'Replaces all occurrences of a string.',
    },
    {
        name: 'REPLICATE',
        signature: 'REPLICATE(str, count)',
        description: 'Repeats a string a specified number of times.',
    },
    { name: 'REVERSE', signature: 'REVERSE(str)', description: 'Reverses the characters in a string.' },
    {
        name: 'RIGHT',
        signature: 'RIGHT(str, length)',
        description: 'Returns the right part of a string.',
    },
    { name: 'RTRIM', signature: 'RTRIM(str)', description: 'Removes trailing whitespace.' },
    {
        name: 'STARTSWITH',
        signature: 'STARTSWITH(str, prefix [, ignoreCase])',
        description: 'Returns true if the string starts with the prefix.',
    },
    {
        name: 'StringEquals',
        signature: 'StringEquals(str1, str2 [, ignoreCase])',
        description: 'Returns true if the two strings are equal.',
    },
    {
        name: 'SUBSTRING',
        signature: 'SUBSTRING(str, startIndex, length)',
        description: 'Returns a substring.',
    },
    { name: 'ToString', signature: 'ToString(expr)', description: 'Converts to a string representation.' },
    { name: 'TRIM', signature: 'TRIM(str)', description: 'Removes leading and trailing whitespace.' },
    { name: 'UPPER', signature: 'UPPER(str)', description: 'Returns the string in uppercase.' },

    // Array functions
    {
        name: 'ARRAY_CONCAT',
        signature: 'ARRAY_CONCAT(arr1, arr2 [, ...])',
        description: 'Concatenates arrays.',
    },
    {
        name: 'ARRAY_CONTAINS',
        signature: 'ARRAY_CONTAINS(arr, value [, partialMatch])',
        description: 'Returns true if the array contains the value.',
    },
    {
        name: 'ARRAY_LENGTH',
        signature: 'ARRAY_LENGTH(arr)',
        description: 'Returns the number of elements in the array.',
    },
    {
        name: 'ARRAY_SLICE',
        signature: 'ARRAY_SLICE(arr, start [, length])',
        description: 'Returns a subset of an array.',
    },
    {
        name: 'SetIntersect',
        signature: 'SetIntersect(arr1, arr2)',
        description: 'Returns elements common to both arrays.',
    },
    {
        name: 'SetUnion',
        signature: 'SetUnion(arr1, arr2)',
        description: 'Returns the union of two arrays.',
    },

    // Date/time functions
    {
        name: 'DateTimeAdd',
        signature: 'DateTimeAdd(part, number, dateTime)',
        description: 'Adds a specified number value to a DateTime string.',
    },
    {
        name: 'DateTimeBin',
        signature: 'DateTimeBin(dateTime, part, binSize [, origin])',
        description: 'Rounds down a DateTime to a bin boundary.',
    },
    {
        name: 'DateTimeDiff',
        signature: 'DateTimeDiff(part, startDateTime, endDateTime)',
        description: 'Returns the difference between two DateTimes.',
    },
    {
        name: 'DateTimeFromParts',
        signature: 'DateTimeFromParts(year, month, day [, hour, minute, second, ms])',
        description: 'Constructs a DateTime from parts.',
    },
    {
        name: 'DateTimePart',
        signature: 'DateTimePart(part, dateTime)',
        description: 'Returns the specified part of a DateTime.',
    },
    {
        name: 'DateTimeToTicks',
        signature: 'DateTimeToTicks(dateTime)',
        description: 'Converts a DateTime to ticks.',
    },
    {
        name: 'DateTimeToTimestamp',
        signature: 'DateTimeToTimestamp(dateTime)',
        description: 'Converts a DateTime to a Unix timestamp.',
    },
    {
        name: 'GetCurrentDateTime',
        signature: 'GetCurrentDateTime()',
        description: 'Returns the current UTC date and time as a string.',
    },
    {
        name: 'GetCurrentDateTimeStatic',
        signature: 'GetCurrentDateTimeStatic()',
        description: 'Returns the current UTC date and time (evaluated once).',
    },
    {
        name: 'GetCurrentTicks',
        signature: 'GetCurrentTicks()',
        description: 'Returns the current UTC time in ticks.',
    },
    {
        name: 'GetCurrentTicksStatic',
        signature: 'GetCurrentTicksStatic()',
        description: 'Returns the current UTC time in ticks (evaluated once).',
    },
    {
        name: 'GetCurrentTimestamp',
        signature: 'GetCurrentTimestamp()',
        description: 'Returns the current UTC Unix timestamp in milliseconds.',
    },
    {
        name: 'GetCurrentTimestampStatic',
        signature: 'GetCurrentTimestampStatic()',
        description: 'Returns the current UTC Unix timestamp (evaluated once).',
    },
    {
        name: 'TicksToDateTime',
        signature: 'TicksToDateTime(ticks)',
        description: 'Converts ticks to a DateTime string.',
    },

    // Spatial functions
    {
        name: 'ST_AREA',
        signature: 'ST_AREA(polygon)',
        description: 'Returns the area of a polygon.',
    },
    {
        name: 'ST_DISTANCE',
        signature: 'ST_DISTANCE(point1, point2)',
        description: 'Returns the distance between two GeoJSON points.',
    },
    {
        name: 'ST_INTERSECTS',
        signature: 'ST_INTERSECTS(geom1, geom2)',
        description: 'Returns true if two geometries intersect.',
    },
    {
        name: 'ST_ISVALID',
        signature: 'ST_ISVALID(geom)',
        description: 'Returns true if the GeoJSON is valid.',
    },
    {
        name: 'ST_ISVALIDDETAILED',
        signature: 'ST_ISVALIDDETAILED(geom)',
        description: 'Returns details about the validity of a GeoJSON.',
    },
    {
        name: 'ST_WITHIN',
        signature: 'ST_WITHIN(point, polygon)',
        description: 'Returns true if the point is within the polygon.',
    },

    // Object functions
    {
        name: 'ObjectToArray',
        signature: 'ObjectToArray(object)',
        description: 'Converts an object to an array of {k, v} pairs.',
    },

    // Conversion functions
    {
        name: 'StringToArray',
        signature: 'StringToArray(str)',
        description: 'Converts a string representation to an array.',
    },
    {
        name: 'StringToBoolean',
        signature: 'StringToBoolean(str)',
        description: 'Converts a string representation to a boolean.',
    },
    {
        name: 'StringToNull',
        signature: 'StringToNull(str)',
        description: 'Converts a string representation to null.',
    },
    {
        name: 'StringToNumber',
        signature: 'StringToNumber(str)',
        description: 'Converts a string representation to a number.',
    },
    {
        name: 'StringToObject',
        signature: 'StringToObject(str)',
        description: 'Converts a string representation to an object.',
    },

    // Vector functions
    {
        name: 'VectorDistance',
        signature: 'VectorDistance(vector1, vector2 [, distanceType, bruteForce])',
        description: 'Returns the distance between two vectors.',
    },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extracts the alias used in the FROM clause. For example:
 *   "SELECT * FROM c"          → "c"
 *   "SELECT * FROM container"  → "container"
 *   "SELECT * FROM c AS doc"   → picks up "c" (since FROM alias is the collection ref)
 *
 * Falls back to "c" which is the most common convention.
 */
function extractFromAlias(text: string): string {
    // Match patterns like: FROM <alias> or FROM <collection> <alias> or FROM <collection> AS <alias>
    const fromMatch = text.match(/\bFROM\s+(\w+)/i);
    return fromMatch?.[1] ?? 'c';
}

/**
 * Resolves the property path typed after an alias and returns matching schema properties.
 * For example, with schema { properties: { address: { properties: { city: ... } } } }:
 *   path = ["address"] → returns the properties of `address`
 *   path = []          → returns the root-level properties
 */
function resolveSchemaProperties(schema: JSONSchema, path: string[]): Record<string, JSONSchema> | undefined {
    let current: JSONSchema = schema;

    for (const segment of path) {
        if (!current.properties) {
            return undefined;
        }

        const prop = (current.properties as unknown as Record<string, JSONSchema>)[segment];
        if (!prop) {
            return undefined;
        }

        // Traverse into the property — it may have its own properties (object type)
        // or it may have anyOf with an entry that has properties
        if (prop.properties) {
            current = prop;
        } else if (prop.anyOf) {
            // Find the object type entry in anyOf
            const objectEntry = (prop.anyOf as JSONSchema[]).find(
                (entry) => entry.type === 'object' || entry.properties,
            );
            if (objectEntry) {
                current = objectEntry;
            } else {
                return undefined;
            }
        } else {
            return undefined;
        }
    }

    if (!current.properties) {
        return undefined;
    }

    return current.properties as unknown as Record<string, JSONSchema>;
}

/**
 * Determines whether the given property name requires bracket notation.
 * Property names with special characters (spaces, dashes, dots, etc.) need `["..."]` syntax.
 */
function needsBracketNotation(name: string): boolean {
    return !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

/**
 * Gets a human-readable type label from a schema property.
 */
function getTypeLabel(propSchema: JSONSchema): string {
    if (propSchema.type) {
        return Array.isArray(propSchema.type) ? propSchema.type.join(' | ') : propSchema.type;
    }

    if (propSchema.anyOf) {
        const types = (propSchema.anyOf as JSONSchema[])
            .map((entry) => entry.type ?? entry['x-bsonType'] ?? 'unknown')
            .filter(Boolean);
        return types.join(' | ');
    }

    return 'unknown';
}

// ─── Completion Provider ───────────────────────────────────────────────────────

/**
 * Creates a CompletionItemProvider for the CosmosDB NoSQL language.
 *
 * @param getSchema - A function that returns the current container schema (or null).
 *                    This is called on every completion request to get fresh schema data.
 */
export function createNoSqlCompletionProvider(
    monacoInstance: typeof monaco,
    getSchema: () => JSONSchema | null,
): monaco.languages.CompletionItemProvider {
    return {
        triggerCharacters: ['.', ' '],

        provideCompletionItems(
            model: monaco.editor.ITextModel,
            position: monaco.Position,
        ): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
            const textUntilPosition = model.getValueInRange({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
            });

            const lineContent = model.getLineContent(position.lineNumber);
            const textBeforeCursor = lineContent.substring(0, position.column - 1);

            const wordInfo = model.getWordUntilPosition(position);
            const range: monaco.IRange = {
                startLineNumber: position.lineNumber,
                startColumn: wordInfo.startColumn,
                endLineNumber: position.lineNumber,
                endColumn: wordInfo.endColumn,
            };

            const suggestions: monaco.languages.CompletionItem[] = [];

            // ── 1. Dot-triggered property completions ──────────────────────
            const dotMatch = textBeforeCursor.match(/(\w+(?:\.\w+)*)\.(\w*)$/);

            if (dotMatch) {
                const schema = getSchema();
                const fullPath = dotMatch[1]; // e.g. "c.address" or "c"
                const segments = fullPath.split('.');
                const fromAlias = extractFromAlias(textUntilPosition);

                // Check if the root segment matches the FROM alias
                if (segments[0].toLowerCase() === fromAlias.toLowerCase()) {
                    // Remove the alias, keep the property path
                    const propertyPath = segments.slice(1);

                    if (schema) {
                        const properties = resolveSchemaProperties(schema, propertyPath);
                        if (properties) {
                            // Adjust range to cover the partial word after the dot
                            const dotRange: monaco.IRange = {
                                startLineNumber: position.lineNumber,
                                startColumn: position.column - (dotMatch[2]?.length ?? 0),
                                endLineNumber: position.lineNumber,
                                endColumn: position.column,
                            };

                            for (const [name, propSchema] of Object.entries(properties)) {
                                const typeLabel = getTypeLabel(propSchema as JSONSchema);
                                const hasChildren = !!(propSchema as JSONSchema).properties;

                                if (needsBracketNotation(name)) {
                                    // For properties needing bracket notation, replace the dot with ["..."]
                                    suggestions.push({
                                        label: {
                                            label: name,
                                            detail: ` (${typeLabel})`,
                                            description: 'bracket notation',
                                        } as monaco.languages.CompletionItemLabel,
                                        kind: monacoInstance.languages.CompletionItemKind.Field,
                                        insertText: `["${name}"]`,
                                        range: {
                                            // Go back one more to replace the dot
                                            startLineNumber: position.lineNumber,
                                            startColumn: position.column - (dotMatch[2]?.length ?? 0) - 1,
                                            endLineNumber: position.lineNumber,
                                            endColumn: position.column,
                                        },
                                        detail: typeLabel,
                                        sortText: `0_${name}`,
                                    });
                                } else {
                                    suggestions.push({
                                        label: {
                                            label: name,
                                            detail: ` (${typeLabel})`,
                                        } as monaco.languages.CompletionItemLabel,
                                        kind: hasChildren
                                            ? monacoInstance.languages.CompletionItemKind.Module
                                            : monacoInstance.languages.CompletionItemKind.Field,
                                        insertText: name,
                                        range: dotRange,
                                        detail: typeLabel,
                                        sortText: `0_${name}`,
                                    });
                                }
                            }
                        }
                    }
                }

                // If dot-triggered, return only property suggestions (don't mix with keywords)
                return { suggestions };
            }

            // ── 2. Keyword completions ─────────────────────────────────────
            for (const keyword of NOSQL_KEYWORDS) {
                suggestions.push({
                    label: keyword,
                    kind: monacoInstance.languages.CompletionItemKind.Keyword,
                    insertText: keyword,
                    range,
                    sortText: `1_${keyword}`,
                });
            }

            // ── 3. Function completions ────────────────────────────────────
            for (const func of NOSQL_FUNCTIONS) {
                suggestions.push({
                    label: {
                        label: func.name,
                        detail: `  ${func.signature}`,
                    } as monaco.languages.CompletionItemLabel,
                    kind: monacoInstance.languages.CompletionItemKind.Function,
                    insertText: `${func.name}($0)`,
                    insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                    detail: func.signature,
                    documentation: func.description,
                    sortText: `2_${func.name}`,
                });
            }

            // ── 4. Alias suggestion (the FROM alias for quick access) ──────
            const fromAlias = extractFromAlias(textUntilPosition);
            suggestions.push({
                label: {
                    label: fromAlias,
                    description: 'collection alias',
                } as monaco.languages.CompletionItemLabel,
                kind: monacoInstance.languages.CompletionItemKind.Variable,
                insertText: fromAlias,
                range,
                detail: 'Collection alias from FROM clause',
                sortText: `0_${fromAlias}`,
            });

            return { suggestions };
        },
    };
}

/**
 * Registers the NoSQL completion provider with Monaco.
 * Returns a disposable that should be cleaned up when no longer needed.
 */
export function registerNoSqlCompletionProvider(
    monacoInstance: typeof monaco,
    getSchema: () => JSONSchema | null,
): monaco.IDisposable {
    const provider = createNoSqlCompletionProvider(monacoInstance, getSchema);
    return monacoInstance.languages.registerCompletionItemProvider(NOSQL_LANGUAGE_ID, provider);
}
