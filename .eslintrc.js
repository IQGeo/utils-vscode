module.exports = {
    env: {
        es2021: true,
        node: true,
    },
    extends: 'eslint:recommended',
    overrides: [
        {
            files: ['.eslintrc.{js,cjs}'],
            parserOptions: {
                sourceType: 'commonjs',
            },
        },
    ],
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
    },
    rules: {},
};
