/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DiffMatchGrader } from '@microsoft/vally';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { checkConversion } from './document-conversion/check.mjs';
import { checkDocument } from './document/check.mjs';
import { checkEvidence } from './evidence/check.mjs';

const checks = new Map([
    ['document-preflight', checkDocument],
    ['document-discovery', checkDocument],
    ['document-assessment', checkDocument],
    ['document-conversion', checkConversion],
    ['document-planning', checkDocument],
    ['unfamiliar-preflight', checkEvidence],
    ['resume-code', checkEvidence],
    ['resume-metadata', checkEvidence],
]);

export function registerGraders(registry) {
    const name = 'source-migration-artifacts';
    const diff = new DiffMatchGrader('diff-not-contains');
    registry.register({
        metadata: {
            name,
            description: 'Check synthetic migration artifacts against trusted source evidence and phase boundaries',
            behavior: { requiresWorkspace: true },
            determinism: 'complex-static',
            reference: 'reference-based',
            temporalScope: 'trajectory-level',
            costProfile: 'free',
        },
        async grade(input) {
            const { trajectory, config } = input;
            const check = checks.get(config?.scenario);
            assert.ok(check, `Unknown source migration scenario: ${config?.scenario}`);
            assert.ok(trajectory?.workDir, 'Artifact grading requires a trial workspace');
            try {
                // Git's diff header gives the original path (also for additions). Renames/copies name the destination
                // separately. Check those headers, not hunk text, before limiting artifact validation to app/.
                const boundary = await diff.grade({
                    ...input,
                    config: { pattern: '(?m)^(?:diff --git (?!"?a/app/)|(?:rename|copy) to (?!"?app/))' },
                });
                if (!boundary.passed) {
                    return {
                        ...boundary,
                        name,
                        evidence:
                            boundary.status === 'error'
                                ? boundary.evidence
                                : 'Workspace diff changes files outside app/',
                    };
                }
                await check(join(realpathSync(trajectory.workDir), 'app'), config.scenario, trajectory);
                return {
                    name,
                    kind: 'code',
                    passed: true,
                    score: 1,
                    evidence: `${config.scenario}: artifacts verified.`,
                };
            } catch (error) {
                return {
                    name,
                    kind: 'code',
                    passed: false,
                    score: 0,
                    evidence: error instanceof Error ? error.message : String(error),
                };
            }
        },
    });
}
