/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONObject, type PartitionKeyDefinition } from '@azure/cosmos';
import { parse as parseJson } from '@prantlf/jsonlint';
import { extractPartitionKey } from '../../utils/document';

export function validateDocument(content: string, partitionKey?: PartitionKeyDefinition) {
    const errors: string[] = [];

    try {
        // Check JSON schema
        const resource = parseJson(content) as JSONObject;

        if (resource === null || typeof resource !== 'object') {
            throw new Error('Document must be an object.');
        }

        // Check partition key
        const partitionKeyError = validatePartitionKey(resource, partitionKey);
        if (partitionKeyError) {
            errors.push(...partitionKeyError);
        }

        const idError = validateDocumentId(resource);
        if (idError) {
            errors.push(...idError);
        }
    } catch (err) {
        if (err instanceof SyntaxError) {
            errors.push(err.message);
        } else if (err instanceof Error) {
            errors.push(err.message);
        } else {
            errors.push('Unknown error');
        }
    }

    return errors;
}

export function validatePartitionKey(
    resource: JSONObject,
    partitionKey?: PartitionKeyDefinition,
): string[] | undefined {
    if (!partitionKey) {
        return undefined;
    }

    const errors: string[] = [];
    const partitionKeyPaths = partitionKey.paths.map((path) => (path.startsWith('/') ? path.slice(1) : path));
    const partitionKeyValues = extractPartitionKey(resource, partitionKey);

    if (!partitionKeyValues) {
        errors.push('Partition key is incomplete.');
    }

    if (Array.isArray(partitionKeyValues)) {
        partitionKeyValues
            .map((value, index) => {
                if (!value) {
                    return `Partition key ${partitionKeyPaths[index]} is invalid.`;
                }
                return null;
            })
            .filter((value) => value !== null)
            .forEach((value) => errors.push(value));
    }

    return errors.length ? errors : undefined;
}

export function validateDocumentId(resource: JSONObject): string[] | undefined {
    const errors: string[] = [];

    if ('id' in resource && resource.id) {
        if (typeof resource.id !== 'string') {
            errors.push('Id must be a string.');
        } else {
            if (
                resource.id.indexOf('/') !== -1 ||
                resource.id.indexOf('\\') !== -1 ||
                resource.id.indexOf('?') !== -1 ||
                resource.id.indexOf('#') !== -1
            ) {
                errors.push('Id contains illegal chars (/, \\, ?, #).');
            }

            if (resource.id[resource.id.length - 1] === ' ') {
                errors.push('Id ends with a space.');
            }
        }
    }

    return errors.length ? errors : undefined;
}
