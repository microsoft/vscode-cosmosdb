/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const lineBreak = /\r\n|[\n\r\u2028\u2029]/u;
const licenseMarker = /\b(?:Copyright|SPDX-License-Identifier)\b|@license\b/iu;

export default {
    meta: {
        fixable: 'code',
        schema: [{ type: 'array', items: { type: 'string' }, minItems: 1 }],
    },
    create(context) {
        const { sourceCode } = context;
        const { text } = sourceCode;
        const newline = text.match(lineBreak)?.[0] ?? '\n';
        const blankLine = newline.repeat(2);
        const expected = context.options[0].join(newline);

        return {
            Program(node) {
                const hashbangEnd = text.match(/^#![^\r\n\u2028\u2029]*/u)?.[0].length ?? 0;
                const before = text.slice(hashbangEnd).match(/^\s*/u)[0];
                const start = hashbangEnd + before.length;
                const firstComment = sourceCode.getAllComments().find((comment) => comment.range[0] >= hashbangEnd);
                const prefix = hashbangEnd ? blankLine : '';

                if (firstComment?.range[0] !== start || !licenseMarker.test(firstComment.value)) {
                    context.report({
                        node,
                        message: 'Missing license header',
                        fix: (fixer) =>
                            fixer.replaceTextRange(
                                [hashbangEnd, start],
                                prefix + expected + (start === text.length ? newline : blankLine),
                            ),
                    });
                    return;
                }

                const end = firstComment.range[1];
                const after = text.slice(end).match(/^\s*/u)[0];
                const hasContentAfter = end + after.length < text.length;
                const validBefore = before.split(lineBreak).length - 1 === (hashbangEnd ? 2 : 0);
                const validAfter = !hasContentAfter || after.split(lineBreak).length - 1 === 2;
                const validHeader = sourceCode.getText(firstComment) === expected;
                if (validHeader && validBefore && validAfter) {
                    return;
                }

                context.report({
                    node: firstComment,
                    message: validHeader ? 'Incorrect spacing around license header' : 'Invalid license header',
                    fix: (fixer) =>
                        fixer.replaceTextRange(
                            [hashbangEnd, end + after.length],
                            (validBefore ? before : prefix) + expected + (validAfter ? after : blankLine),
                        ),
                });
            },
        };
    },
};
