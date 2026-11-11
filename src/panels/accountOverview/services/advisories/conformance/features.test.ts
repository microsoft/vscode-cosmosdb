/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { executeCase } from './bindings';
import { loadFeatures, parseFeature } from './features';

describe('original Gherkin execution infrastructure', () => {
    it('uses the official compiler for Background and every row of multiple Examples blocks', () => {
        const cases = parseFeature(
            `
Feature: Synthetic parser fixture
  Background:
    Given a fixture
  Scenario Outline: Expanded <label>
    When the value is <value>
    Then the label is <label>
    Examples:
      | value | label |
      | 2     | first |
      | 4     | next  |
    Examples:
      | value | label |
      | 6     | last  |
`,
            'dx900_parser.feature',
        );
        expect(cases).toHaveLength(3);
        expect(cases.map((entry) => entry.pickle.name)).toEqual(['Expanded first', 'Expanded next', 'Expanded last']);
        expect(cases[2].pickle.steps.map((step) => [step.type, step.text])).toEqual([
            ['Context', 'a fixture'],
            ['Action', 'the value is 6'],
            ['Outcome', 'the label is last'],
        ]);
        expect(new Set(cases.map((entry) => entry.pickle.id)).size).toBe(3);
    });

    it('rejects malformed or empty contracts rather than reporting zero passing tests', () => {
        expect(() => parseFeature('not gherkin', 'dx900_parser.feature')).toThrow('Invalid Gherkin');
        expect(() => parseFeature('Feature: Empty\n', 'dx900_parser.feature')).toThrow('No executable scenarios');
        expect(() => parseFeature('Feature: Unknown\n', 'unknown.feature')).toThrow('Unknown CODA feature');
    });

    it('requires an inventory but permits empty nested folders alongside features', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'coda-parser-test-'));
        onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
        mkdirSync(path.join(directory, 'empty'));
        expect(() => loadFeatures(directory)).toThrow('No CODA scenarios found');
        writeFileSync(
            path.join(directory, 'dx900_synthetic.feature'),
            `
Feature: Synthetic inventory
  Scenario: Present
    Given a fixture
`,
        );
        expect(loadFeatures(directory)).toHaveLength(1);
    });

    it('calls production sizing and registry, and fails a wrong expected value', async () => {
        const source = `
Feature: Synthetic native evaluation fixture
  Scenario: Manual observations
    Given a manual container with 5000 RU/s and 48 samples at 8 percent utilization
    When CODA evaluates DX-001
    Then the utilization band is low
    And the recommended throughput is 520 RU/s
    And the wasted capacity is 4480 RU/s
`;
        const [testCase] = parseFeature(source, 'dx001_synthetic.feature');
        expect(await executeCase(testCase)).toBe(3);
        const [wrong] = parseFeature(source.replace('520 RU/s', '521 RU/s'), 'dx001_synthetic.feature');
        await expect(executeCase(wrong)).rejects.toThrow('Expected 521');
    });

    it('does not silently skip an unknown detector or an unknown assertion', async () => {
        const [unknownRule] = parseFeature(
            `
Feature: Synthetic unsupported detector
  Scenario: Explicitly unbound
    Given a fixture
    When a fixture runs
    Then a fixture is checked
`,
            'dx900_synthetic.feature',
        );
        await expect(executeCase(unknownRule)).rejects.toThrow('not implemented for DX-900');
        const [unknownStep] = parseFeature(
            `
Feature: Synthetic unsupported assertion
  Scenario: Explicitly unbound
    Given a manual container with 5000 RU/s and 48 samples at 8 percent utilization
    When CODA evaluates DX-001
    Then an unknown invariant holds
`,
            'dx001_synthetic.feature',
        );
        await expect(executeCase(unknownStep)).rejects.toThrow('Unbound Outcome step');
    });

    it('rejects table arguments and scenarios without assertions', async () => {
        const [table] = parseFeature(
            `
Feature: Synthetic unsupported arguments
  Scenario: Data table
    Given a manual container with 5000 RU/s and 48 samples at 8 percent utilization
      | input |
      | value |
    When CODA evaluates DX-001
    Then the utilization band is low
`,
            'dx001_synthetic.feature',
        );
        await expect(executeCase(table)).rejects.toThrow('step tables');
        const [noAssertion] = parseFeature(
            `
Feature: Synthetic incomplete scenario
  Scenario: Missing assertion
    Given a manual container with 5000 RU/s and 48 samples at 8 percent utilization
    When CODA evaluates DX-001
`,
            'dx001_synthetic.feature',
        );
        await expect(executeCase(noAssertion)).rejects.toThrow('assert at least one outcome');
    });
});
