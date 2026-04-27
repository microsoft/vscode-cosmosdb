/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from 'eslint/config';
import ts from 'typescript-eslint';

/**
 * Minimal ESLint config — almost all rules have been migrated to oxlint (.oxlintrc.jsonc).
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
            // packages/ are inert in this PR — no monorepo wiring yet (Phase 0/1).
            // Lint will be re-enabled when pnpm workspace is configured.
            'packages',
            '**/__mocks__/**/*',
            '**/*.d.ts',
            '**/vitest.config.ts',
            '**/main.js',
        ],
    },
    // TypeScript parser — required so ESLint can parse .ts/.tsx AST correctly.
    {
        files: ['**/*.ts', '**/*.tsx'],
        plugins: { '@typescript-eslint': ts.plugin },
        languageOptions: {
            ecmaVersion: 2024,
            parser: ts.parser,
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
                project: './tsconfig.eslint.json',
                projectService: false,
                tsconfigRootDir: import.meta.dirname,
            },
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
                {
                    // Matches only `import vscode from 'vscode'` (ImportDefaultSpecifier),
                    // NOT `import * as vscode from 'vscode'` (ImportNamespaceSpecifier).
                    selector: 'ImportDeclaration[source.value="vscode"] > ImportDefaultSpecifier',
                    message:
                        'Use \'import * as vscode from "vscode"\' instead. Default import returns undefined in ESM.',
                },
            ],
        },
    },
]);
