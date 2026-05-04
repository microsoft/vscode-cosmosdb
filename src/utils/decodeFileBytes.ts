/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Decodes a byte buffer to a string, detecting common BOMs.
 *
 * Supports:
 * - UTF-8 with BOM (EF BB BF)
 * - UTF-16 LE with BOM (FF FE) — common for SSMS-exported SQL scripts
 * - UTF-16 BE with BOM (FE FF)
 * - No BOM → assumed UTF-8
 *
 * The BOM is stripped from the returned string.
 */
export function decodeFileBytes(bytes: Uint8Array): string {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }
    return new TextDecoder('utf-8').decode(bytes);
}
