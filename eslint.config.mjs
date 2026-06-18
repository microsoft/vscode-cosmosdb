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
            'packages/*/dist',
            'packages/*/node_modules',
            'playwright-report',
            'test/e2e/.results',
            'test/e2e/.reports',
            '**/__mocks__/**/*',
            '**/*.d.ts',
            '**/vitest.config.ts',
            '**/main.js',
            'packages/*/vitest.config.ts',
            'packages/*/tests/**/*.mjs',
            'packages/*/scripts/**/*.mjs',
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
                // Steer the small null-check helpers to our isomorphic copies in `src/utils/nonNull`.
                // The `@microsoft/vscode-azext-utils` barrel imports `vscode` values at runtime, so
                // importing these from it couples the module to vscode and breaks webview/`packages`
                // builds. Our local versions depend only on the isomorphic `@vscode/l10n`.
                // This deny-list is meant to grow over time as more vscode-coupled helpers gain
                // isomorphic local equivalents.
                {
                    selector:
                        'ImportDeclaration[source.value="@microsoft/vscode-azext-utils"] ImportSpecifier[imported.name="nonNullValue"]',
                    message:
                        "Import nonNullValue from 'src/utils/nonNull' instead (isomorphic; avoids coupling to vscode).",
                },
                {
                    selector:
                        'ImportDeclaration[source.value="@microsoft/vscode-azext-utils"] ImportSpecifier[imported.name="nonNullProp"]',
                    message:
                        "Import nonNullProp from 'src/utils/nonNull' instead (isomorphic; avoids coupling to vscode).",
                },
                {
                    selector:
                        'ImportDeclaration[source.value="@microsoft/vscode-azext-utils"] ImportSpecifier[imported.name="nonNullOrEmptyValue"]',
                    message:
                        "Import nonNullOrEmptyValue from 'src/utils/nonNull' instead (isomorphic; avoids coupling to vscode).",
                },
                {
                    selector:
                        'ImportDeclaration[source.value="@microsoft/vscode-azext-utils"] ImportSpecifier[imported.name="nonNullValueAndProp"]',
                    message:
                        "Import nonNullValueAndProp from 'src/utils/nonNull' instead (isomorphic; avoids coupling to vscode).",
                },
                {
                    selector:
                        'ImportDeclaration[source.value="@microsoft/vscode-azext-utils"] ImportSpecifier[imported.name="openUrl"]',
                    message:
                        "Import openUrl from 'src/utils/openUrl' instead (single local source; avoids coupling to vscode-azext-utils).",
                },
                {
                    selector:
                        'ImportDeclaration[source.value="@microsoft/vscode-azext-utils"] ImportSpecifier[imported.name="randomUtils"]',
                    message:
                        'Use the isomorphic Web Crypto API (globalThis.crypto) instead of randomUtils, e.g. crypto.randomUUID() or crypto.getRandomValues(new Uint8Array(n)).',
                },
                {
                    selector:
                        'ImportDeclaration[source.value="@microsoft/vscode-azext-utils"] ImportSpecifier[imported.name="createContextValue"]',
                    message:
                        "Use TreeElementWithContextValue.createContextValue from 'src/tree/TreeElementWithContextValue' instead (local, vscode-free).",
                },
            ],
        },
    },
]);
