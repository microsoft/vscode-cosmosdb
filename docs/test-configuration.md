# Test Configuration Documentation

This project uses **two separate test frameworks** for different testing purposes:

## 📋 Test Structure Overview

```
vscode-cosmosdb/
├── src/                          # Source code
│   └── **/*.test.ts              # Jest unit tests (15 files) ✅
├── test/                         # Integration tests
│   └── **/*.test.ts              # Mocha integration tests (4 files) ✅
├── tsconfig.json                 # Main TypeScript config (src only)
├── tsconfig.jest.json            # Jest unit tests config
└── tsconfig.test.json            # Mocha integration tests config
```

---

## 🎯 Why Two Test Frameworks?

### Jest Tests (`src/**/*.test.ts`)

- **Purpose**: Fast, isolated unit tests
- **Location**: Colocated with source code
- **Features**:
  - Built-in mocking (`jest.mock()`)
  - Snapshot testing
  - Coverage reports
  - Fast execution
- **Examples**: `survey.scoring.test.ts`, `toSlickGridTree.test.ts`

### Mocha Tests (`test/**/*.test.ts`)

- **Purpose**: Integration/E2E tests with VS Code extension host
- **Location**: Separate `test/` directory
- **Features**:
  - Runs in VS Code test environment
  - Tests real extension behavior
  - Access to VS Code API
  - Slower execution
- **Examples**: `improveError.test.ts`, `global.test.ts`

---

## 📝 TypeScript Configurations

### 1. `tsconfig.json` (Main - Source Code Only)

```json
{
  "compilerOptions": {
    "module": "esnext",
    "types": ["node"]
    // ... other options
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["test", "src/**/*.test.ts", "**/__mocks__"]
}
```

- Compiles only production source code
- Excludes all test files
- Used by: `pnpm run build`, `pnpm run compile`

### 2. `tsconfig.jest.json` (Jest Unit Tests)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "commonjs",
    "types": ["jest", "node"]
  },
  "include": ["src/**/*.test.ts", "src/**/__mocks__/**/*.ts"],
  "exclude": ["test"]
}
```

- Compiles Jest unit tests in `src/`
- Includes Jest type definitions
- Used by: `pnpm run jesttest` (via jest.config.js)

### 3. `tsconfig.test.json` (Mocha Integration Tests)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "commonjs",
    "types": ["mocha", "node"]
  },
  "include": ["test/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- Compiles Mocha integration tests in `test/`
- Includes Mocha type definitions
- Used by: `pnpm run pretest`, `pnpm run test`

---

## 🔧 ESLint Configuration

The `eslint.config.mjs` has **separate configurations** for each test type:

### Jest Tests Configuration

```javascript
{
  files: ['src/**/*.test.ts', '**/__mocks__/**/*.js'],
  plugins: { jest },
  extends: [jest.configs['flat/recommended']],
  languageOptions: {
    globals: { ...globals.jest }
  },
  rules: {
    'jest/expect-expect': 'off',
    // ... Jest-specific rules
  }
}
```

### Mocha Tests Configuration

```javascript
{
  files: ['test/**/*.ts', 'test/**/*.test.ts'],
  plugins: { mocha },
  languageOptions: {
    globals: { ...globals.mocha }
  },
  rules: {
    'mocha/no-exclusive-tests': 'error',
    'mocha/no-skipped-tests': 'warn',
    // ... Mocha-specific rules
  }
}
```

---

## 🚀 Running Tests

### Jest Unit Tests (Fast)

```bash
pnpm run jesttest
```

- Runs all `src/**/*.test.ts` files
- No VS Code extension host needed
- Fast execution (~seconds)
- Good for TDD/rapid development

### Mocha Integration Tests (Slow)

```bash
pnpm run pretest    # Compile tests
pnpm run test       # Run in VS Code test environment
```

- Runs all `test/**/*.test.ts` files
- Requires VS Code extension host
- Slower execution (~minutes)
- Tests real extension integration

---

## ✍️ Writing Tests

### Jest Unit Test Example

```typescript
// src/utils/myFeature.test.ts
import { myFunction } from './myFeature';

describe('myFunction', () => {
  test('should do something', () => {
    expect(myFunction(42)).toBe(84);
  });
});
```

### Mocha Integration Test Example

```typescript
// test/myIntegration.test.ts
import assert from 'assert';
import * as vscode from 'vscode';

suite('My Integration Tests', () => {
  test('should work with VS Code API', async () => {
    const result = await vscode.window.showInformationMessage('Test');
    assert.ok(result);
  });
});
```

---

## 🎯 Key Differences

| Feature         | Jest (`src/`)                      | Mocha (`test/`)                 |
| --------------- |------------------------------------| ------------------------------- |
| **Syntax**      | `describe()`, `test()`, `expect()` | `suite()`, `test()`, `assert()` |
| **Mocking**     | Built-in `jest.mock()`             | Manual (sinon, etc.)            |
| **Speed**       | ⚡ Fast                             | 🐌 Slow                         |
| **Environment** | Node.js                            | VS Code Extension Host          |
| **Purpose**     | Unit tests                         | Integration tests               |
| **TSConfig**    | `tsconfig.jest.json`               | `tsconfig.test.json`            |

---

## 📦 Configuration Files Summary

| File                 | Purpose                 | Compiles                        |
| -------------------- | ----------------------- | ------------------------------- |
| `tsconfig.json`      | Production source       | `src/**/*.ts` (excluding tests) |
| `tsconfig.jest.json` | Jest unit tests         | `src/**/*.test.ts`              |
| `tsconfig.test.json` | Mocha integration tests | `test/**/*.test.ts`             |
| `jest.config.js`     | Jest configuration      | References `tsconfig.jest.json` |
| `.vscode-test.js`    | VS Code test runner     | References `tsconfig.test.json` |
| `eslint.config.mjs`  | Linting                 | Separate rules for Jest/Mocha   |

---

## 🔍 Troubleshooting

### "Cannot find name 'describe'" in Jest test

- Make sure the file is in `src/**/*.test.ts`
- Check that `tsconfig.jest.json` includes the file
- Verify ESLint is using Jest globals for that file

### "Cannot find name 'suite'" in Mocha test

- Make sure the file is in `test/**/*.test.ts`
- Check that `tsconfig.test.json` includes the file
- Verify ESLint is using Mocha globals for that file

### Type conflicts between Jest and Mocha

- This is now resolved by separate tsconfig files
- Each test type has its own type definitions
- Main `tsconfig.json` excludes all test files

---

## ✅ Benefits of This Setup

1. **Clear separation** of concerns (unit vs integration)
2. **No type conflicts** between Jest and Mocha
3. **Faster unit tests** with Jest
4. **Proper integration testing** with Mocha
5. **Industry standard** pattern for VS Code extensions
6. **Better developer experience** with proper IDE support

---

## 📚 Similar Projects

This pattern is used by Microsoft's official VS Code extensions:

- `vscode-azureresourcegroups`
- `vscode-docker`
- `vscode-kubernetes-tools`

---

_Last updated: 2025-12-30_
