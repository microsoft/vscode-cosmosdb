module.exports = {
    env: {
        es6: true,
        node: true,
    },
    parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2022,
    },
    plugins: ['@typescript-eslint', 'import', 'license-header'],
    extends: ['eslint:recommended'],
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

    overrides: [
        {
            files: ['**/*.ts', '**/*.tsx'],
            parser: '@typescript-eslint/parser',
            parserOptions: {
                project: 'tsconfig.json',
                sourceType: 'module',
            },
            plugins: ['@typescript-eslint'],
            extends: [
                'plugin:@typescript-eslint/recommended',
                'plugin:@typescript-eslint/recommended-requiring-type-checking',
            ],
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
            env: {
                jest: true, // now src/**/*.test.ts files' env has both es6 *and* jest
            },
            parser: '@typescript-eslint/parser',
            parserOptions: {
                project: 'tsconfig.json',
                sourceType: 'module',
            },
            extends: [
                'plugin:@typescript-eslint/recommended',
                'plugin:@typescript-eslint/recommended-requiring-type-checking',
                'plugin:jest/recommended',
            ],
            plugins: ['@typescript-eslint', 'jest'],
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
            env: {
                mocha: true,
            },
            parser: '@typescript-eslint/parser',
            parserOptions: {
                project: 'tsconfig.json',
                sourceType: 'module',
            },
            extends: [
                'plugin:@typescript-eslint/recommended',
                'plugin:@typescript-eslint/recommended-requiring-type-checking',
            ],
            plugins: ['@typescript-eslint', 'mocha'],
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
    ],
};
