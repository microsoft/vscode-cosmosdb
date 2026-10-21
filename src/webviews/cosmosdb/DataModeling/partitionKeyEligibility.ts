/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type SchemaProperty } from './models';

type PartitionKeyProperty = Pick<SchemaProperty, 'name' | 'type' | 'hasArrayAncestor' | 'hasNonScalarValues'>;

export function getPartitionKeyRestriction(
    property: PartitionKeyProperty,
    properties: readonly PartitionKeyProperty[],
): 'arrayAncestor' | 'nonScalar' | undefined {
    if (
        property.hasArrayAncestor ||
        properties.some(
            (parent) =>
                property.name.startsWith(`${parent.name}/`) && (parent.type === 'array' || parent.type === 'number[]'),
        )
    ) {
        return 'arrayAncestor';
    }
    if (
        property.hasNonScalarValues ||
        property.type === 'object' ||
        property.type === 'array' ||
        property.type === 'number[]'
    ) {
        return 'nonScalar';
    }
    return undefined;
}
