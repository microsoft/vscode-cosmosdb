/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export default {
    meta: {
        schema: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    selector: { type: 'string', minLength: 1 },
                    message: { type: 'string', minLength: 1 },
                },
                required: ['selector', 'message'],
                additionalProperties: false,
            },
        },
    },
    create(context) {
        const visitors = new Map();
        for (const { selector, message } of context.options) {
            const previous = visitors.get(selector);
            visitors.set(selector, (node) => {
                previous?.(node);
                context.report({ node, message });
            });
        }
        return Object.fromEntries(visitors);
    },
};
