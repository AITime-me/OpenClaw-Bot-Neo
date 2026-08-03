import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'tests/fixtures/**', 'scripts/**/*.d.mts'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/**', '**/providers/**', '**/integrations/**', '**/monitors/**'],
              message: 'Core cannot depend on implementations.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSAsExpression > TSUnknownKeyword',
          message:
            'Double assertions through unknown are forbidden: they would let unchecked data pose as a sealed security type.',
        },
      ],
    },
  },
  {
    files: ['src/neo-runtime/cli/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: [
      'scripts/integration/**/*.ts',
      'tests/durable-composition-linux-gate.test.ts',
      'tests/integration-boundary-enforcement.test.ts',
      'tests/neo-runtime-linux-gate.test.ts',
      'tests/neo-runtime-linux-gate-bootstrap.test.ts',
      'tests/integration-event-correlation.test.ts',
      'tests/neo-runtime-status-cli.test.ts',
      'tests/neo-runtime-systemd-template.test.ts',
      'tests/validate-neo-systemd-template.test.ts',
      'tests/protocol-event-stream.test.ts',
      'tests/child-argv.test.ts',
      'tests/child-stderr.test.ts',
      'tests/ts-source-resolve.test.ts',
      'tests/ts-source-resolve-subprocess.test.ts',
    ],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./tsconfig.integration.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.js', '*.config.cjs', '.*.cjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        module: 'readonly',
        require: 'readonly',
        URL: 'readonly',
      },
      parserOptions: { projectService: false },
    },
  },
);
