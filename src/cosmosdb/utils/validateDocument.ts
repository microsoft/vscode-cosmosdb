/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONObject, type PartitionKeyDefinition } from '@azure/cosmos';
import { parse as parseJson } from '@prantlf/jsonlint';
import * as l10n from '@vscode/l10n';
import { extractPartitionKey } from '../../utils/document';

export function validateDocument(
    content: string,
    partitionKey?: PartitionKeyDefinition,
    allowNullOrUndefinedPartitionKey: boolean = true,
) {
    const errors: string[] = [];

    try {
        // Check JSON schema
        const resource = parseJson(content) as JSONObject;

        if (resource && typeof resource !== 'object') {
            throw new Error(l10n.t('Item must be an object.'));
        }

        // Check partition key
        const partitionKeyError = validatePartitionKey(resource, partitionKey, allowNullOrUndefinedPartitionKey);
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
            errors.push(l10n.t('Unknown error'));
        }
    }

    return errors;
}

export function validatePartitionKey(
    resource: JSONObject,
    partitionKey?: PartitionKeyDefinition,
    allowNullOrUndefined: boolean = false,
): string[] | undefined {
    if (!partitionKey || allowNullOrUndefined) {
        return undefined;
    }

    const partitionKeyPaths = partitionKey.paths.map((path) => (path.startsWith('/') ? path.slice(1) : path));
    const partitionKeyValues = extractPartitionKey(resource, partitionKey);
    const values = Array.isArray(partitionKeyValues) ? partitionKeyValues : [partitionKeyValues];
    const errors = values
        .map((value, index) => {
            if (!value) {
                return l10n.t('Partition key {path} is invalid.', { path: partitionKeyPaths[index] });
            }
            return null;
        })
        .filter((value) => value !== null);

    return errors.length ? errors : undefined;
}

export function validateDocumentId(resource: JSONObject): string[] | undefined {
    const errors: string[] = [];

    if ('id' in resource && resource.id) {
        if (typeof resource.id !== 'string') {
            errors.push(l10n.t('Id must be a string.'));
        } else {
            if (
                resource.id.indexOf('/') !== -1 ||
                resource.id.indexOf('\\') !== -1 ||
                resource.id.indexOf('?') !== -1 ||
                resource.id.indexOf('#') !== -1
            ) {
                errors.push(l10n.t('Id contains illegal chars (/, \\, ?, #).'));
            }

            if (resource.id[resource.id.length - 1] === ' ') {
                errors.push(l10n.t('Id ends with a space.'));
            }
        }
    }

    return errors.length ? errors : undefined;
}
