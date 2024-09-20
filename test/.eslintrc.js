module.exports = {
    extends: ['../.eslintrc.js'],
    parserOptions: {
        project: '../tsconfig.json',
        sourceType: 'module',
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
        'no-restricted-imports': ['error', { patterns: ['**/src/'] }],
    },
};
