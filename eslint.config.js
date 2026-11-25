/**
 * ESLint flat config: ban CommonJS require() in the ESM packages
 * (server, rules-engine, shared). A dynamic require() in those packages
 * is how ~30 hooks silently broke on Nov 15 — the load threw, a nearby
 * catch swallowed it, and the hook never ran.
 *
 * `npm run lint:require` runs tools/ban-cjs-require.mjs, an equivalent
 * scanner that does not need the eslint package installed. If you install
 * eslint, this config's no-restricted-syntax rule is the formal version
 * of the same check:
 *
 *   npx eslint server/src rules-engine/src shared/src --no-error-on-unmatched-pattern
 *
 * CommonJS patch/tooling files (*.cjs) are left alone.
 */
export default [
  {
    files: [
      'server/src/**/*.{ts,tsx,js,mjs}',
      'server/scripts/**/*.{ts,tsx,js,mjs}',
      'rules-engine/src/**/*.{ts,tsx,js,mjs}',
      'shared/src/**/*.{ts,tsx,js,mjs}',
    ],
    ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/*.cjs'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='require']",
          message:
            'Do not use require() in ESM packages (server, rules-engine, shared). Use a static import, or import() only for a real cycle. Swallowed require() failures hid the Nov 15 hook breakages.',
        },
        {
          selector: "CallExpression[callee.property.name='createRequire']",
          message:
            'Do not use module.createRequire() in ESM packages (server, rules-engine, shared). Use a static import instead.',
        },
      ],
    },
  },
];
