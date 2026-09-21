/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * NOTE: This function is async-friendly by design so it can be moved to the backend in the future.
 */

import { type SerializedQueryResult } from '../../cosmosdb/types/queryResult';

const encoder = new TextEncoder();
const DEFAULT_JSON_CHUNK_CHARACTERS = 64 * 1024;

function* getPrettyPrintedJsonChunks(queryResult: SerializedQueryResult): Generator<string> {
    yield '[';

    if (queryResult.documents.length === 0) {
        yield ']';
        return;
    }

    yield '\n';

    for (const [documentIndex, document] of queryResult.documents.entries()) {
        const serializedDocument = JSON.stringify(document, null, 4);
        const lines = serializedDocument.split('\n');

        for (const [lineIndex, line] of lines.entries()) {
            if (lineIndex > 0) {
                yield '\n';
            }
            yield `    ${line}`;
        }

        if (documentIndex < queryResult.documents.length - 1) {
            yield ',';
        }
        yield '\n';
    }

    yield ']';
}

const decodeUtf8Prefix = (value: string, maximumBytes: number): string => {
    const encoded = encoder.encode(value);
    if (encoded.byteLength <= maximumBytes) {
        return value;
    }

    for (let end = maximumBytes; end >= Math.max(0, maximumBytes - 3); end--) {
        try {
            return new TextDecoder('utf-8', { fatal: true }).decode(encoded.subarray(0, end));
        } catch {
            // A UTF-8 code point can span at most four bytes, so retry at the previous boundary.
        }
    }

    return '';
};

const getSafeChunkEnd = (
    value: string,
    start: number,
    maximumCharacters: number,
    allowSurrogatePairOverflow: boolean,
): number => {
    let end = Math.min(value.length, start + maximumCharacters);

    if (
        end < value.length &&
        end > start &&
        value.charCodeAt(end - 1) >= 0xd800 &&
        value.charCodeAt(end - 1) <= 0xdbff &&
        value.charCodeAt(end) >= 0xdc00 &&
        value.charCodeAt(end) <= 0xdfff
    ) {
        end = end - start === 1 && allowSurrogatePairOverflow ? end + 1 : end - 1;
    }

    return end;
};

export function* getQueryResultJsonChunks(
    queryResult: SerializedQueryResult,
    maximumBytes = Number.POSITIVE_INFINITY,
    targetChunkCharacters = DEFAULT_JSON_CHUNK_CHARACTERS,
): Generator<string> {
    if (maximumBytes <= 0 || targetChunkCharacters <= 0) {
        return;
    }

    let buffered = '';
    let remainingBytes = maximumBytes;

    for (const jsonPart of getPrettyPrintedJsonChunks(queryResult)) {
        let partOffset = 0;

        while (partOffset < jsonPart.length) {
            const availableCharacters = targetChunkCharacters - buffered.length;
            const partEnd = getSafeChunkEnd(jsonPart, partOffset, availableCharacters, buffered.length === 0);

            if (partEnd === partOffset && buffered) {
                const chunk = decodeUtf8Prefix(buffered, remainingBytes);
                if (chunk) {
                    yield chunk;
                    remainingBytes -= encoder.encode(chunk).byteLength;
                }

                if (chunk.length < buffered.length || remainingBytes <= 0) {
                    return;
                }

                buffered = '';
                continue;
            }

            buffered += jsonPart.slice(partOffset, partEnd);
            partOffset = partEnd;

            if (buffered.length < targetChunkCharacters) {
                continue;
            }

            const chunk = decodeUtf8Prefix(buffered, remainingBytes);
            if (chunk) {
                yield chunk;
                remainingBytes -= encoder.encode(chunk).byteLength;
            }

            if (chunk.length < buffered.length || remainingBytes <= 0) {
                return;
            }

            buffered = '';
        }
    }

    if (buffered) {
        const chunk = decodeUtf8Prefix(buffered, remainingBytes);
        if (chunk) {
            yield chunk;
        }
    }
}

export const queryResultToJSON = (queryResult: SerializedQueryResult | null, selection?: number[]): string => {
    if (!queryResult) {
        return '';
    }

    if (selection) {
        const selectedDocs = queryResult.documents
            .map((doc, index) => {
                if (!selection.includes(index)) {
                    return null;
                }
                return doc;
            })
            .filter((doc) => doc !== null);

        return JSON.stringify(selectedDocs, null, 4);
    }

    return JSON.stringify(queryResult.documents, null, 4);
};

export const getQueryResultJsonByteLength = (queryResult: SerializedQueryResult): number => {
    let byteLength = 0;

    for (const chunk of getQueryResultJsonChunks(queryResult)) {
        byteLength += encoder.encode(chunk).byteLength;
    }

    return byteLength;
};

export type QueryResultJsonPreview = {
    json: string;
    isTruncated: boolean;
};

export const createQueryResultJsonPreview = (
    queryResult: SerializedQueryResult,
    maximumBytes: number,
): QueryResultJsonPreview => {
    let json = '';

    for (const chunk of getQueryResultJsonChunks(queryResult, maximumBytes)) {
        json += chunk;
    }

    return {
        json,
        isTruncated: getQueryResultJsonByteLength(queryResult) > encoder.encode(json).byteLength,
    };
};
