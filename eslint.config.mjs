/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from 'eslint/config';
import ts from 'typescript-eslint';

/**
 * Minimal ESLint config — almost all rules have been migrated to oxlint (.oxlintrc.json).
 * ESLint is kept only for `no-restricted-syntax`, which uses AST node selectors that oxlint
 * does not support. Type-aware rules are handled by oxlint via `options.typeAware: true`.
 */
export default defineConfig([
    {
        ignores: [
            '.azure-pipelines',
            '.config',
            '.github',
            '.vscode-test',
            'coverage',
            'dist',
            'out',
            'node_modules',
            '**/__mocks__/**/*',
            '**/*.d.ts',
            '**/jest.config.js',
            '**/main.js',
        ],
    },
    // TypeScript parser — required so ESLint can parse .ts/.tsx AST correctly.
    {
        files: ['**/*.ts', '**/*.tsx'],
        plugins: { '@typescript-eslint': ts.plugin },
        languageOptions: {
            parser: ts.parser,
            ecmaVersion: 2023,
            sourceType: 'module',
        },
    },
    // The only rule that cannot be expressed in oxlint: no-restricted-syntax uses
    // AST node selectors to enforce the @vscode/l10n import convention.
    {
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'ImportDeclaration[source.value="vscode"] ImportSpecifier[imported.name="l10n"]',
                    message:
                        'Please use "import * as l10n from \'@vscode/l10n\';" instead of importing l10n from vscode.',
                },
                {
                    selector: 'MemberExpression[object.name="vscode"][property.name="l10n"]',
                    message:
                        'Please use "import * as l10n from \'@vscode/l10n\';" and use l10n directly instead of vscode.l10n.',
                },
            ],
        },
    },
]);
