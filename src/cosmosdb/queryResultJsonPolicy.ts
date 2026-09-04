/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const QUERY_RESULT_JSON_WARNING_BYTES = 5 * 1024 * 1024;
export const QUERY_RESULT_JSON_PREVIEW_BYTES = 512 * 1024;

export const isLargeQueryResultJson = (byteLength: number): boolean => byteLength > QUERY_RESULT_JSON_WARNING_BYTES;
