/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { classifyEnvironment } from './environmentClassifier';

describe('classifyEnvironment', () => {
    it('reads a canonical environment tag with highest priority', () => {
        const result = classifyEnvironment('anything', { Environment: 'Production' });
        expect(result.inferredEnv).toBe('prod');
        expect(result.isNonProd).toBe(false);
    });

    it('normalises synonym tag values', () => {
        expect(classifyEnvironment('acct', { env: 'nonprod' }).inferredEnv).toBe('dev');
        expect(classifyEnvironment('acct', { stage: 'UAT' }).inferredEnv).toBe('uat');
    });

    it('ignores non-environment tag values (SKU classes)', () => {
        // "premium" is not an environment, so it must not leak through — falls back to name/sub (unknown here).
        expect(classifyEnvironment('acct', { tier: 'premium' }).inferredEnv).toBe('unknown');
    });

    it('does not mis-classify embedded prod inside nonprod', () => {
        const result = classifyEnvironment('nonprodjpe01');
        expect(result.inferredEnv).toBe('dev');
        expect(result.isNonProd).toBe(true);
    });

    it('does not treat prod-suffixed names as non-prod on a substring', () => {
        expect(classifyEnvironment('stagecoach-prod').inferredEnv).toBe('prod');
        expect(classifyEnvironment('qatar-prod').inferredEnv).toBe('prod');
    });

    it('matches separator-bounded prod tokens', () => {
        expect(classifyEnvironment('myapp-prod-eastus').inferredEnv).toBe('prod');
        expect(classifyEnvironment('prod01').inferredEnv).toBe('prod');
    });

    it('lets a specific account-level non-prod env override a broad subscription prod', () => {
        const result = classifyEnvironment('team-uat-account', undefined, 'Production Subscription');
        expect(result.inferredEnv).toBe('uat');
        expect(result.isNonProd).toBe(true);
    });

    it('ranks subscription name above account name when the account name is unknown', () => {
        const result = classifyEnvironment('data01', undefined, 'dev-subscription');
        expect(result.inferredEnv).toBe('dev');
    });

    it('returns unknown (treated as production) with no signals', () => {
        const result = classifyEnvironment('data01');
        expect(result.inferredEnv).toBe('unknown');
        expect(result.isNonProd).toBe(false);
    });

    it('classifies common non-prod name tokens', () => {
        expect(classifyEnvironment('orders-test').isNonProd).toBe(true);
        expect(classifyEnvironment('orders-staging').isNonProd).toBe(true);
        expect(classifyEnvironment('perf-cluster').isNonProd).toBe(true);
        expect(classifyEnvironment('sandbox-1').isNonProd).toBe(true);
    });
});
