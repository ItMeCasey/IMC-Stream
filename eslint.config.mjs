// Catches real mistakes (undefined names) and dead code (unused variables) in the Node files. The HTML pages' inline scripts are not covered.
const node = { require: 'readonly', module: 'writable', exports: 'writable', process: 'readonly', Buffer: 'readonly', __dirname: 'readonly', console: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', setImmediate: 'readonly', fetch: 'readonly', URL: 'readonly',
  URLSearchParams: 'readonly', WebSocket: 'readonly', FormData: 'readonly', Blob: 'readonly', Response: 'readonly', AbortController: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly', globalThis: 'readonly', crypto: 'readonly', window: 'readonly' };
export default [
  { ignores: ['**/node_modules/**', 'server/public/**',  'server/kokoro/**', 'app/dist/**', 'app/release/**', 'data/**', '_build/**', 'overlays/config.js'] },
  { files: ['server/**/*.js', 'app/**/*.js', 'overlays/beat.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: node },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }] } },
  { files: ['server/*-test.js', 'server/test-mock.js', 'server/selftest.js', 'app/*-test.js'], rules: { 'no-unused-vars': 'off' } },   // tests keep a few scratch variables
];
