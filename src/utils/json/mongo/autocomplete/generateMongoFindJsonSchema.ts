/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type FieldEntry } from './getKnownFields';

/**
 * Generates a JSON schema for MongoDB find filter queries.
 *
 * This function is a short-term solution for providing autocompletion for MongoDB find filter queries.
 * A MongoDB find filter query is a JSON document that can range from simple to complex structures.
 * Basic autocompletion can be provided using a modified JSON schema, which is what we've done here.
 *
 * The long-term plan is to provide a more sophisticated auto-completion using, for example,
 * the suggestion API that Monaco provides. This will be looked at in the future.
 *
 * @param fieldEntries - An array of field entries where each entry contains:
 *   - path: A string representing the full path of the field in the dataset (e.g., "age", "address.city").
 *   - type: The most common or expected data type for that field (e.g., "number", "string").
 *
 * The data provided is supposed to contain all known data paths from the expected dataset,
 * focusing only on leaf nodes.
 *
 * The returned JSON schema can be directly added to the Monaco editor to activate autocompletion.
 *
 * @returns A JSON schema object that can be used for autocompletion in the Monaco editor.
 */
export function generateMongoFindJsonSchema(fieldEntries: FieldEntry[]) {
    // Initialize the base schema object
    const schema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        $id: 'mongodb-filter-schema',
        title: 'MongoDB Find Filter Schema',
        type: 'object',
        properties: {},
        additionalProperties: {
            oneOf: [
                {
                    title: 'Direct Value',
                    description: 'A direct value for equality matching on an unknown field.',
                    examples: ['value', 123, true, null],
                },
                {
                    title: 'Operator-Based Query',
                    $ref: '#/definitions/operatorObjectUnknown',
                    examples: [{ $ne: 'inactive' }, { $exists: true }],
                },
            ],
        },
        definitions: {
            operatorObject: {
                type: 'object',
                properties: {
                    $eq: {
                        description: 'Matches values that are equal to a specified value.',
                        examples: [21, 'active', true],
                    },
                    $ne: {
                        description: 'Matches all values that are not equal to a specified value.',
                        examples: [30, 'inactive', false],
                    },
                    $gt: {
                        description: 'Matches values that are greater than a specified value.',
                        examples: [25, 100],
                    },
                    $gte: {
                        description: 'Matches values that are greater than or equal to a specified value.',
                        examples: [18, 50],
                    },
                    $lt: {
                        description: 'Matches values that are less than a specified value.',
                        examples: [65, 100],
                    },
                    $lte: {
                        description: 'Matches values that are less than or equal to a specified value.',
                        examples: [30, 75],
                    },
                    $in: {
                        type: 'array',
                        description: 'Matches any of the values specified in an array.',
                        examples: [
                            ['red', 'blue'],
                            [21, 30, 40],
                        ],
                    },
                    $nin: {
                        type: 'array',
                        description: 'Matches none of the values specified in an array.',
                        examples: [['green'], [50, 60]],
                    },
                    $exists: {
                        type: 'boolean',
                        description: 'Matches documents that have the specified field.',
                        examples: [true, false],
                    },
                    $regex: {
                        description: 'Provides regular expression capabilities for pattern matching strings.',
                        examples: ['^re', '.*blue$', '^[A-Z]+'],
                    },
                },
                additionalProperties: false,
                description: 'An object containing a MongoDB query operator and its corresponding value.',
                minProperties: 1,
            },
            operatorObjectUnknown: {
                $ref: '#/definitions/operatorObject',
            },
        },
        description:
            'Schema for MongoDB find query filters, supporting known fields with various operators for querying documents.',
    };

    // Set to collect all full paths
    const fullPathsSet = new Set<string>();

    // Function to generate examples based on type
    function generateExamples(type: string): unknown[] {
        let examples;
        if (type === 'number') {
            examples = [42, 100];
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            examples.push(false); // odd type
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            examples.push(null);
        } else if (type === 'string') {
            examples = ['red', 'blue'];
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            examples.push(null);
        } else if (type === 'boolean') {
            examples = [true, false];
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            examples.push(null);
        } else {
            examples = ['value', 123, true, null];
        }
        return examples as [];
    }

    // Function to generate examples for operator-based queries
    function generateOperatorExamples(type: string): unknown[] {
        let examples;
        if (type === 'number') {
            examples = [{ $gt: 25 }, { $in: [20, 30, 40] }];
        } else if (type === 'string') {
            examples = [{ $regex: '^re' }, { $ne: 'blue' }];
        } else if (type === 'boolean') {
            examples = [{ $eq: true }, { $ne: false }];
        } else {
            examples = [{ $exists: true }];
        }
        return examples as [];
    }

    // Function to create nested properties based on path components
    function createNestedProperty(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        obj: any,
        pathComponents: string[],
        type: string,
        currentPath: string = '',
    ) {
        const fieldName = pathComponents[0];
        const newPath = currentPath ? `${currentPath}.${fieldName}` : fieldName;

        fullPathsSet.add(newPath);

        if (pathComponents.length === 1) {
            // Leaf node
            const examples = generateExamples(type);
            const operatorExamples = generateOperatorExamples(type);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            obj[fieldName] = {
                oneOf: [
                    {
                        title: 'Direct Value',
                        description: `A direct value for equality matching on the '${fieldName}' field.`,
                        examples: examples,
                    },
                    {
                        title: 'Operator-Based Query',
                        $ref: '#/definitions/operatorObject',
                        examples: operatorExamples,
                    },
                ],
            };
        } else {
            // Nested object
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            if (!obj[fieldName]) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                obj[fieldName] = {
                    type: 'object',
                    properties: {},
                    additionalProperties: false,
                    description: `Embedded '${fieldName}' object containing fields.`,
                };
            }
            createNestedProperty(
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                obj[fieldName]['properties'],
                pathComponents.slice(1),
                type,
                newPath,
            );
        }
    }

    // Process each fieldEntry
    for (const fieldEntry of fieldEntries) {
        const pathComponents = fieldEntry.path.split('.');
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        createNestedProperty(schema['properties'], pathComponents, fieldEntry.type);
    }

    // Function to get type for a full path
    function getTypeForFullPath(fullPath: string): string | undefined {
        for (const fieldEntry of fieldEntries) {
            if (fieldEntry.path === fullPath) {
                return fieldEntry.type;
            }
        }
        return undefined;
    }

    // Create properties with full paths at the root level
    for (const fullPath of fullPathsSet) {
        const type = getTypeForFullPath(fullPath) || 'string';
        const examples = generateExamples(type);
        const operatorExamples = generateOperatorExamples(type);

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        schema['properties'][fullPath] = {
            oneOf: [
                {
                    title: 'Direct Value',
                    description: `A direct value for equality matching on the '${fullPath}' field.`,
                    examples: examples,
                },
                {
                    title: 'Operator-Based Query',
                    $ref: '#/definitions/operatorObject',
                    examples: operatorExamples,
                },
            ],
        };
    }

    // Add logical operators
    const logicalOperators = ['$or', '$and', '$not', '$nor'];
    for (const operator of logicalOperators) {
        if (operator === '$not') {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            schema['properties'][operator] = {
                oneOf: [{ $ref: '#' }],
                description: `Inverts the effect of a query expression.`,
            };
        } else {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            schema['properties'][operator] = {
                type: 'array',
                items: { $ref: '#' },
                description: `Joins query clauses with a logical ${operator.toUpperCase().substring(1)}.`,
            };
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return schema;
}
