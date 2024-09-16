module.exports = {
    env: {
        es6: true,
        node: true,
    },
    parser: '@typescript-eslint/parser',
    parserOptions: {
        project: 'tsconfig.json',
        sourceType: 'module',
    },
    plugins: ['@typescript-eslint', 'import'],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:@typescript-eslint/recommended-requiring-type-checking',
    ],
    rules: {
        '@typescript-eslint/no-restricted-types': 'error',
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/no-inferrable-types': 'off',
        '@typescript-eslint/no-namespace': 'off',
        '@typescript-eslint/no-unnecessary-type-assertion': 'off',
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        '@typescript-eslint/prefer-regexp-exec': 'off',
        '@typescript-eslint/require-await': 'warn',
        '@typescript-eslint/restrict-template-expressions': 'off',
        '@typescript-eslint/unbound-method': 'warn',
        eqeqeq: ['error', 'always'],
        'import/consistent-type-specifier-style': ['error', 'prefer-inline'],
        'import/no-internal-modules': [
            'error',
            {
                allow: ['antlr4ts/**', 'yaml/types'],
            },
        ],
        'no-case-declarations': 'error',
        'no-constant-condition': 'error',
        'no-inner-declarations': 'error',
        'no-restricted-imports': ['error', { patterns: ['**/*/extension.bundle'] }],
        'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        'no-useless-escape': 'error',
    },
};
