/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { type DataModelingRouterContext } from '../appRouter';
vi.mock('../trpc', async () => {
    const { initTRPC } = await import('@trpc/server');
    const t = initTRPC.create();
    return { dataModelingProcedure: t.procedure, dataModelingRouter: t.router };
});
import { DataModelingEventSchema, dataModelingEventsRouterDef } from './dataModelingEventsRouter';

describe('data modeler event correlation', () => {
    it('keeps event-stream failures outside generic error telemetry', async () => {
        const error = new Error('PRIVATE RESPONSE');
        const ctx = {
            actionContext: { telemetry: {}, errorHandling: {} },
            eventSink: {
                async *[Symbol.asyncIterator]() {
                    yield { type: 'recommendationError', message: 'PRIVATE RESPONSE' };
                    throw error;
                },
            },
        } as unknown as DataModelingRouterContext;
        const stream = await dataModelingEventsRouterDef.createCaller(ctx).events();
        const iterator = stream[Symbol.asyncIterator]();
        await iterator.next();
        await expect(iterator.next()).rejects.toBe(error);
        expect(ctx.actionContext?.telemetry.suppressAll).toBe(true);
        expect(ctx.actionContext?.errorHandling.suppressDisplay).toBe(true);
    });

    it.each([
        { type: 'recommendationReceived', recommendation: { summary: '', containers: [] } },
        { type: 'recommendationError', message: 'Reason' },
    ])('preserves optional attempt identifiers for $type and accepts legacy messages', (event) => {
        const requestId = '12345678-1234-4123-8123-123456789001';
        expect(DataModelingEventSchema.parse(event)).toEqual(event);
        expect(DataModelingEventSchema.parse({ ...event, requestId })).toEqual({ ...event, requestId });
        expect(DataModelingEventSchema.safeParse({ ...event, requestId: 'user supplied text' }).success).toBe(false);
    });
});
