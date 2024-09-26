/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * We're not using the full JSON schema spec, so we're defining a subset of it here.
 * There is @types/json-schema available, but their support ends at JSON Schema draft-07,
 * there is another one with vscode-json-languageservice, but then it'd be harder to
 * extract our code to a separate and independend package in the future.
 *
 * Rather than working with an older version of the spec, we're defining a subset of the
 * spec that we need to work with here.
 *
 * The purpose of this JSON schema is to:
 * 1. Provide input to Monaco
 * 2. Extract statistical information from the user data
 * 3. Discover data for different levels of the structure-tree used in the table view
 */

export type JSONSchemaRef = JSONSchema | boolean;
export interface JSONSchema {
    id?: string;
    $id?: string;
    $schema?: string;
    type?: string | string[];
    'x-documentsInspected'?: number;
    'x-occurrence'?: number;
    'x-typeOccurrence'?: number;
    'x-bsonType'?: string; // Explicitly declare the key with a dash using quotes
    title?: string;
    definitions?: {
        [name: string]: JSONSchema;
    };
    description?: string;
    properties?: JSONSchema; // changed from: JSONSchemaMap;
    patternProperties?: JSONSchemaMap;
    additionalProperties?: JSONSchemaRef;
    minProperties?: number;
    maxProperties?: number;
    dependencies?:
        | JSONSchemaMap
        | {
              [prop: string]: string[];
          };
    items?: JSONSchemaRef | JSONSchemaRef[];

    required?: string[];
    $ref?: string;
    anyOf?: JSONSchemaRef[];
    allOf?: JSONSchemaRef[];
    oneOf?: JSONSchemaRef[];
    not?: JSONSchemaRef;
    enum?: undefined[];
    format?: string;
    const?: undefined;
    contains?: JSONSchemaRef;
    propertyNames?: JSONSchemaRef;
    examples?: undefined[];
    $comment?: string;

    $defs?: {
        [name: string]: JSONSchema;
    };
    markdownEnumDescriptions?: string[];
    markdownDescription?: string;
    doNotSuggest?: boolean;
    suggestSortText?: string;
}
export interface JSONSchemaMap {
    [name: string]: JSONSchemaRef;
}
