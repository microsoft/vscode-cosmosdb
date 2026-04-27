/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONSchema7 } from 'json-schema';

/**
 * Extended JSON Schema (draft-07) with vendor `x-*` properties for
 * document schema analysis statistics.
 *
 * Extends the standard {@link JSONSchema7} from `@types/json-schema` so consumers
 * get full draft-07 support (if/then/else, minimum, maximum, etc.) plus our
 * analysis-specific extensions.
 *
 * The purpose of these extensions is to:
 * 1. Provide input to Monaco / other editors for autocompletion
 * 2. Extract statistical information from user data
 * 3. Discover data structure at different levels of nesting (e.g. for table views)
 */

export interface JSONSchema extends JSONSchema7 {
    // ── Override recursive fields to reference our extended type ─────────
    properties?: { [key: string]: JSONSchemaRef };
    patternProperties?: { [key: string]: JSONSchemaRef };
    additionalProperties?: JSONSchemaRef;
    items?: JSONSchemaRef | JSONSchemaRef[];
    additionalItems?: JSONSchemaRef;
    contains?: JSONSchema;
    dependencies?: { [key: string]: JSONSchemaRef | string[] };
    propertyNames?: JSONSchemaRef;
    if?: JSONSchemaRef;
    then?: JSONSchemaRef;
    else?: JSONSchemaRef;
    allOf?: JSONSchemaRef[];
    anyOf?: JSONSchemaRef[];
    oneOf?: JSONSchemaRef[];
    not?: JSONSchemaRef;
    definitions?: { [key: string]: JSONSchemaRef };

    // ── Vendor extensions: analysis statistics ──────────────────────────

    /** Number of documents inspected to build this schema node */
    'x-documentsInspected'?: number;
    /** Number of documents where this property was present */
    'x-occurrence'?: number;
    /** Number of documents where this type was observed */
    'x-typeOccurrence'?: number;

    /** Original BSON type tag (BSON analyzer) */
    'x-bsonType'?: string;
    /** Original data type tag (JSON analyzer) */
    'x-dataType'?: string;

    /** Observed min/max property count for objects */
    'x-minProperties'?: number;
    'x-maxProperties'?: number;

    /** Observed min/max item count for arrays */
    'x-minItems'?: number;
    'x-maxItems'?: number;

    /** Observed min/max string length or binary size */
    'x-maxLength'?: number;
    'x-minLength'?: number;

    /** Observed min/max numeric value */
    'x-maxValue'?: number;
    'x-minValue'?: number;

    /** Observed min/max date (epoch ms) */
    'x-minDate'?: number;
    'x-maxDate'?: number;

    /** Observed boolean true/false counts */
    'x-trueCount'?: number;
    'x-falseCount'?: number;
}

/**
 * A schema reference — either a full schema object or a boolean
 * (`true` = accept all, `false` = reject all), matching JSON Schema draft-07.
 */
export type JSONSchemaRef = JSONSchema | boolean;

export interface JSONSchemaMap {
    [name: string]: JSONSchemaRef;
}
