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
        '@typescript-eslint/ban-types': 'off',
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/no-inferrable-types': 'off',
        '@typescript-eslint/no-namespace': 'off',
        '@typescript-eslint/no-unnecessary-type-assertion': 'off',
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        '@typescript-eslint/prefer-regexp-exec': 'off',
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/restrict-template-expressions': 'off',
        '@typescript-eslint/unbound-method': 'off',
        eqeqeq: ['error', 'always'],
        'import/consistent-type-specifier-style': ['error', 'prefer-inline'],
        'import/no-internal-modules': [
            'error',
            {
                allow: ['antlr4ts/**', 'yaml/types'],
            },
        ],
        'no-case-declarations': 'off',
        'no-constant-condition': ['error', { checkLoops: false }],
        'no-inner-declarations': 'off',
        'no-restricted-imports': ['error', { patterns: ['**/*/extension.bundle'] }],
        'no-unused-vars': 'off',
        'no-useless-escape': 'off',
    },
};
