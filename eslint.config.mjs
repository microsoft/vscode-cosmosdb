/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import jest from 'eslint-plugin-jest';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import licenseHeader from 'eslint-plugin-license-header';
import mocha from 'eslint-plugin-mocha';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

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
    {
        extends: [js.configs.recommended],

        plugins: {
            import: importPlugin,
            'license-header': licenseHeader,
        },

        languageOptions: {
            globals: {
                ...globals.node,
            },

            ecmaVersion: 2023,
            sourceType: 'module',
        },

        rules: {
            eqeqeq: ['error', 'always'],
            'import/consistent-type-specifier-style': ['error', 'prefer-inline'],
            'import/no-internal-modules': ['error', { allow: ['antlr4ts/**', 'yaml/types'] }],
            'no-case-declarations': 'error',
            'no-constant-condition': 'error',
            'no-inner-declarations': 'error',
            'no-restricted-imports': ['error', { patterns: ['**/*/extension.bundle'] }],
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'no-useless-escape': 'error',
            'license-header/header': [
                'error',
                [
                    '/*---------------------------------------------------------------------------------------------',
                    ' *  Copyright (c) Microsoft Corporation. All rights reserved.',
                    ' *  Licensed under the MIT License. See License.txt in the project root for license information.',
                    ' *--------------------------------------------------------------------------------------------*/',
                ],
            ],
        },
    },
    {
        files: ['**/*.ts'],

        extends: [ts.configs.recommendedTypeChecked],

        plugins: {
            '@typescript-eslint': ts.plugin,
        },

        languageOptions: {
            parser: ts.parser,
            ecmaVersion: 2023,
            sourceType: 'module',

            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },

        rules: {
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/no-base-to-string': 'warn',
            '@typescript-eslint/no-inferrable-types': 'off',
            '@typescript-eslint/no-namespace': 'off',
            '@typescript-eslint/no-restricted-types': 'error',
            '@typescript-eslint/no-unnecessary-type-assertion': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/prefer-regexp-exec': 'off',
            '@typescript-eslint/require-await': 'warn',
            '@typescript-eslint/restrict-template-expressions': 'off',
            '@typescript-eslint/unbound-method': 'warn',
        },
    },
    {
        files: ['**/*.tsx'],

        extends: [
            ts.configs.recommendedTypeChecked,
            react.configs.flat.recommended,
            jsxA11y.flatConfigs.recommended,
            react.configs.flat['jsx-runtime'],
            reactHooks.configs['recommended-latest'],
        ],

        plugins: {
            react: react,
            '@typescript-eslint': ts.plugin,
        },

        languageOptions: {
            parser: ts.parser,
            ecmaVersion: 2023,
            sourceType: 'module',

            ...jsxA11y.flatConfigs.recommended.languageOptions,

            globals: {
                ...globals.browser,
            },

            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },

        settings: {
            react: {
                version: 'detect',
            },
        },

        rules: {
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/no-base-to-string': 'warn',
            '@typescript-eslint/no-inferrable-types': 'off',
            '@typescript-eslint/no-namespace': 'off',
            '@typescript-eslint/no-restricted-types': 'error',
            '@typescript-eslint/no-unnecessary-type-assertion': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/prefer-regexp-exec': 'off',
            '@typescript-eslint/require-await': 'warn',
            '@typescript-eslint/restrict-template-expressions': 'off',
            '@typescript-eslint/unbound-method': 'warn',
        },
    },
    {
        files: ['src/**/*.test.ts', '**/__mocks__/**/*.js'],

        extends: [ts.configs.recommendedTypeChecked, jest.configs['flat/recommended']],

        plugins: {
            '@typescript-eslint': ts.plugin,
            jest: jest,
        },

        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.jest,
            },

            parser: ts.parser,
            ecmaVersion: 2023,
            sourceType: 'module',

            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },

        rules: {
            '@typescript-eslint/no-empty-function': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-floating-promises': 'off',
            '@typescript-eslint/no-misused-promises': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/require-await': 'off',
            'no-dupe-else-if': 'off',
            'no-empty': 'off',
        },
    },
    {
        files: ['test/**/*.ts', 'test/**/*.test.ts'],

        extends: [ts.configs.recommendedTypeChecked],

        plugins: {
            '@typescript-eslint': ts.plugin,
            mocha,
        },

        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.mocha,
            },

            parser: ts.parser,
            ecmaVersion: 2023,
            sourceType: 'module',

            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },

        rules: {
            '@typescript-eslint/no-empty-function': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-floating-promises': 'off',
            '@typescript-eslint/no-misused-promises': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/require-await': 'off',
            'no-dupe-else-if': 'off',
            'no-empty': 'off',
            'no-restricted-imports': 'off',
        },
    },
]);
