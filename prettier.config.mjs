/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @see https://prettier.io/docs/configuration
 * @type {import("prettier").Config}
 */
const config = {
    printWidth: 120,
    tabWidth: 4,
    endOfLine: 'auto',
    useTabs: false,
    semi: true,
    singleQuote: true,
    trailingComma: 'all',
    bracketSpacing: true,
    arrowParens: 'always',
    plugins: ['prettier-plugin-organize-imports'],
    overrides: [
        {
            files: ['*.md', '*.json'],
            options: {
                tabWidth: 2,
            },
        },
    ],
};

export default config;
