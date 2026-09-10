/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { buildRecommendationPrompt } from './dataModelingRouter';

vi.mock('../../../chat/reportPartitionKeyRecommendationTool', () => ({
    REPORT_PARTITION_KEY_RECOMMENDATION_TOOL_NAME: 'cosmosdb_reportPartitionKeyRecommendation',
}));
vi.mock('../trpc', async () => {
    const { initTRPC } = await import('@trpc/server');
    const t = initTRPC.create();
    return { dataModelingProcedure: t.procedure, dataModelingRouter: t.router };
});

describe('priority recommendation prompt', () => {
    it('requires detailed skill reading and independent component scores, not weighted LLM totals', () => {
        const prompt = buildRecommendationPrompt('{"containers":[]}', 'wizard-id', {
            read: 50,
            write: 30,
            storage: 20,
        });
        expect(prompt).toContain('cosmosdb-best-practices');
        expect(prompt).toContain('Reading only the skill overview is not sufficient');
        expect(prompt).toContain('label the recommendation as provisional');
        expect(prompt).toContain('{"read":50,"write":30,"storage":20}');
        expect(prompt).toContain('Do not apply the weights to these component scores');
        expect(prompt).toContain('(readScore*readWeight + writeScore*writeWeight + storageScore*storageWeight)/100');
        expect(prompt).toContain('priorityScores: {read, write, storage}');
        expect(prompt).toContain('not measured performance');
        expect(prompt).toContain('immutability');
        expect(prompt).toContain('hierarchical prefix routing');
        expect(prompt).toContain('Do not submit a single combined score or rank verdict');
        expect(prompt).toContain('wizardTabId "wizard-id"');
        expect(prompt).toContain('{"containers":[]}');
    });
});
