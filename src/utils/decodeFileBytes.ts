/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Encoding label returned alongside the decoded text. */
export type FileEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be';

export interface DecodedFile {
    text: string;
    encoding: FileEncoding;
}

/**
 * Decodes a byte buffer to a string, detecting common BOMs.
 *
 * Supports:
 * - UTF-8 with BOM (EF BB BF) → encoding: 'utf-8-bom'
 * - UTF-16 LE with BOM (FF FE) → 'utf-16le' (common for SSMS-exported SQL)
 * - UTF-16 BE with BOM (FE FF) → 'utf-16be'
 * - No BOM → 'utf-8'
 *
 * The BOM is stripped from the returned `text`.
 */
export function decodeFileBytes(bytes: Uint8Array): DecodedFile {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
    }
    return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' };
}
