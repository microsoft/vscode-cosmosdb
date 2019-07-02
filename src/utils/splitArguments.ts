/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function splitArguments(args: string | undefined): string[] {
    if (!args) {
        return [];
    }

    let matches: RegExpMatchArray | null = args.match(/('[^']+')|("[^']+")|([^\s]+)/g);
    return matches ? matches : [];
}
