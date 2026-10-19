/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Escape literal data before interpolating it into advisory text with authored backtick highlights. */
export function escapeAdvisoryText(text: string): string {
    return text.replace(/[\\`]/g, '\\$&');
}

export interface AdvisoryTextPart {
    text: string;
    highlighted: boolean;
}

/** Only inline backticks and escaped backticks/backslashes are markup; all other content remains literal text. */
export function parseAdvisoryText(text: string): AdvisoryTextPart[] {
    const parts: AdvisoryTextPart[] = [];
    let buffer = '';
    let highlighted = false;
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (character === '\\' && (text[index + 1] === '`' || text[index + 1] === '\\')) {
            buffer += text[++index];
        } else if (character === '`') {
            if (highlighted) {
                parts.push({ text: buffer || '``', highlighted: buffer.length > 0 });
            } else if (buffer) {
                parts.push({ text: buffer, highlighted: false });
            }
            buffer = '';
            highlighted = !highlighted;
        } else {
            buffer += character;
        }
    }
    if (buffer || highlighted) {
        parts.push({ text: (highlighted ? '`' : '') + buffer, highlighted: false });
    }
    return parts;
}
