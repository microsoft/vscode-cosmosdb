/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TypedEventSink } from './TypedEventSink';

type NumEvent = { type: 'num'; value: number };
type StrEvent = { type: 'str'; value: string };

describe('TypedEventSink', () => {
    it('should deliver emitted events in order', async () => {
        const sink = new TypedEventSink<NumEvent>();
        const results: NumEvent[] = [];

        // Buffer events before iteration starts
        sink.emit({ type: 'num', value: 1 });
        sink.emit({ type: 'num', value: 2 });
        sink.emit({ type: 'num', value: 3 });
        sink.close();

        for await (const event of sink) {
            results.push(event);
        }

        expect(results).toEqual([
            { type: 'num', value: 1 },
            { type: 'num', value: 2 },
            { type: 'num', value: 3 },
        ]);
    });

    it('should deliver events emitted during iteration', async () => {
        const sink = new TypedEventSink<StrEvent>();
        const results: StrEvent[] = [];

        const consumePromise = (async () => {
            for await (const event of sink) {
                results.push(event);
            }
        })();

        // Emit after consumer is waiting
        sink.emit({ type: 'str', value: 'a' });
        sink.emit({ type: 'str', value: 'b' });

        // Give the event loop a tick to process
        await new Promise((resolve) => setTimeout(resolve, 0));

        sink.emit({ type: 'str', value: 'c' });
        sink.close();

        await consumePromise;

        expect(results).toEqual([
            { type: 'str', value: 'a' },
            { type: 'str', value: 'b' },
            { type: 'str', value: 'c' },
        ]);
    });

    it('should complete the iterator when close() is called', async () => {
        const sink = new TypedEventSink<NumEvent>();

        const consumePromise = (async () => {
            const results: NumEvent[] = [];
            for await (const event of sink) {
                results.push(event);
            }
            return results;
        })();

        sink.emit({ type: 'num', value: 42 });
        sink.close();

        const results = await consumePromise;
        expect(results).toEqual([{ type: 'num', value: 42 }]);
    });

    it('should complete immediately if closed before iteration', async () => {
        const sink = new TypedEventSink<NumEvent>();
        sink.close();

        const results: NumEvent[] = [];
        for await (const event of sink) {
            results.push(event);
        }

        expect(results).toEqual([]);
    });

    it('should throw if multiple consumers try to iterate', () => {
        const sink = new TypedEventSink<NumEvent>();

        // First consumer
        sink[Symbol.asyncIterator]();

        // Second consumer should throw
        expect(() => sink[Symbol.asyncIterator]()).toThrow('TypedEventSink supports only a single consumer');
    });

    it('should silently drop events emitted after close()', async () => {
        const sink = new TypedEventSink<NumEvent>();

        sink.emit({ type: 'num', value: 1 });
        sink.close();
        sink.emit({ type: 'num', value: 2 }); // Should be dropped

        const results: NumEvent[] = [];
        for await (const event of sink) {
            results.push(event);
        }

        expect(results).toEqual([{ type: 'num', value: 1 }]);
    });

    it('should report isClosed correctly', () => {
        const sink = new TypedEventSink<NumEvent>();
        expect(sink.isClosed).toBe(false);

        sink.close();
        expect(sink.isClosed).toBe(true);
    });

    it('should handle close() while consumer is waiting for next event', async () => {
        const sink = new TypedEventSink<NumEvent>();

        const consumePromise = (async () => {
            const results: NumEvent[] = [];
            for await (const event of sink) {
                results.push(event);
            }
            return results;
        })();

        // Give consumer time to start waiting
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Close while consumer is blocked on next()
        sink.close();

        const results = await consumePromise;
        expect(results).toEqual([]);
    });

    it('should work with discriminated union event types', async () => {
        type TestEvent = { type: 'start'; id: string } | { type: 'data'; payload: number } | { type: 'end' };

        const sink = new TypedEventSink<TestEvent>();

        sink.emit({ type: 'start', id: 'abc' });
        sink.emit({ type: 'data', payload: 42 });
        sink.emit({ type: 'end' });
        sink.close();

        const results: TestEvent[] = [];
        for await (const event of sink) {
            results.push(event);
        }

        expect(results).toEqual([{ type: 'start', id: 'abc' }, { type: 'data', payload: 42 }, { type: 'end' }]);
    });

    it('should support two-arg emit with type and payload', async () => {
        type TestEvent = { type: 'start'; id: string } | { type: 'data'; payload: number } | { type: 'end' };

        const sink = new TypedEventSink<TestEvent>();

        sink.emit('start', { id: 'abc' });
        sink.emit('data', { payload: 42 });
        sink.emit('end', {});
        sink.close();

        const results: TestEvent[] = [];
        for await (const event of sink) {
            results.push(event);
        }

        expect(results).toEqual([{ type: 'start', id: 'abc' }, { type: 'data', payload: 42 }, { type: 'end' }]);
    });
});
