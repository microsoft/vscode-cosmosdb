/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TRPCClientError } from '@trpc/client';
import { type AnyRouter } from '@trpc/server';
import { vi, type Mock } from 'vitest';
import { vscodeLink, type VsCodeLinkRequestMessage, type VsCodeLinkResponseMessage } from './vscodeLink';

/**
 * Creates a mock Operation object for testing.
 * The `context.trpc.requestId` field is set to a deterministic value
 * so tests can predict the operationId used by the link.
 */
function createMockOp(
    type: 'query' | 'mutation' | 'subscription',
    path: string,
    requestId: string,
    signal?: AbortSignal | null,
) {
    return {
        id: 0,
        type,
        path,
        input: undefined,
        context: { trpc: { requestId } },
        signal: signal ?? null,
    };
}

/**
 * Sets up the vscodeLink with mock send/onReceive functions and subscribes
 * to the observable returned for a given operation.
 *
 * Returns helpers to simulate server responses and inspect calls.
 */
function createTestHarness(op: ReturnType<typeof createMockOp>) {
    const sentMessages: VsCodeLinkRequestMessage[] = [];
    const send: Mock = vi.fn((msg: VsCodeLinkRequestMessage) => {
        sentMessages.push(msg);
    });

    // Capture the callback registered via onReceive so we can simulate server responses
    let receiveCallback: ((message: VsCodeLinkResponseMessage) => void) | null = null;
    const unsubscribeFn: Mock = vi.fn();
    const onReceive: Mock = vi.fn((cb: (message: VsCodeLinkResponseMessage) => void) => {
        receiveCallback = cb;
        return unsubscribeFn;
    });

    const link = vscodeLink<AnyRouter>({ send, onReceive });
    // vscodeLink returns: (runtime) => ({ op, next }) => Observable
    // runtime is unused (_runtime), so we pass a dummy
    // next is unused (terminating link), so we pass a dummy
    const linkRuntime = link({} as never);
    const observable = linkRuntime({ op, next: (() => {}) as never } as never);

    // Observer callbacks
    const onNext: Mock = vi.fn();
    const onError: Mock = vi.fn();
    const onComplete: Mock = vi.fn();

    // Subscribe to the observable
    const subscription = observable.subscribe({
        next: onNext,
        error: onError,
        complete: onComplete,
    });

    /** Simulate a response from the server to the client */
    function simulateResponse(message: VsCodeLinkResponseMessage) {
        if (!receiveCallback) {
            throw new Error('onReceive callback not registered — link setup failed');
        }
        receiveCallback(message);
    }

    return {
        send,
        onReceive,
        unsubscribeFn,
        sentMessages,
        subscription,
        onNext,
        onError,
        onComplete,
        simulateResponse,
    };
}

describe('vscodeLink', () => {
    describe('query operations', () => {
        it('should send the operation and receive data', () => {
            const op = createMockOp('query', 'common.reportEvent', 'q-1');
            const { sentMessages, onNext, onComplete, simulateResponse } = createTestHarness(op);

            // The link should have sent the operation (signal is stripped by sendSafe before postMessage)
            expect(sentMessages).toHaveLength(1);
            expect(sentMessages[0].id).toBe('q-1');
            const { signal: _sig, ...expectedOp } = op;
            void _sig;
            expect(sentMessages[0].op).toEqual(expectedOp);

            // Simulate the server responding
            simulateResponse({ id: 'q-1', result: { text: 'hello' } });

            // The observer should have received the data wrapped in { result: { data } }
            expect(onNext).toHaveBeenCalledTimes(1);
            expect(onNext).toHaveBeenCalledWith({
                result: { data: { text: 'hello' } },
            });

            // Queries auto-complete after receiving a result
            expect(onComplete).toHaveBeenCalledTimes(1);
        });

        it('should ignore messages with a different operationId', () => {
            const op = createMockOp('query', 'some.path', 'q-2');
            const { onNext, simulateResponse } = createTestHarness(op);

            // Send a response with a different id
            simulateResponse({ id: 'wrong-id', result: 'nope' });

            expect(onNext).not.toHaveBeenCalled();
        });
    });

    describe('mutation operations', () => {
        it('should send and complete after receiving a result', () => {
            const op = createMockOp('mutation', 'common.reportEvent', 'm-1');
            const { sentMessages, onNext, onComplete, simulateResponse } = createTestHarness(op);

            expect(sentMessages).toHaveLength(1);
            expect(sentMessages[0].op.type).toBe('mutation');

            simulateResponse({ id: 'm-1', result: 'ok' });

            expect(onNext).toHaveBeenCalledTimes(1);
            expect(onNext).toHaveBeenCalledWith({ result: { data: 'ok' } });
            expect(onComplete).toHaveBeenCalledTimes(1);
        });
    });

    describe('error handling', () => {
        it('should propagate errors via TRPCClientError', () => {
            const op = createMockOp('query', 'some.path', 'e-1');
            const { onNext, onError, onComplete, simulateResponse } = createTestHarness(op);

            simulateResponse({
                id: 'e-1',
                error: {
                    name: 'TRPCError',
                    message: 'Something went wrong',
                    code: -32600,
                },
            });

            expect(onError).toHaveBeenCalledTimes(1);
            const error = onError.mock.calls[0][0];
            expect(error).toBeInstanceOf(TRPCClientError);
            expect(error.message).toBe('Something went wrong');

            // No data or completion should have been emitted
            expect(onNext).not.toHaveBeenCalled();
            expect(onComplete).not.toHaveBeenCalled();
        });

        it('should propagate errors for subscriptions', () => {
            const op = createMockOp('subscription', 'some.sub', 'e-2');
            const { onError, simulateResponse } = createTestHarness(op);

            simulateResponse({
                id: 'e-2',
                error: {
                    name: 'Error',
                    message: 'Subscription failed',
                },
            });

            expect(onError).toHaveBeenCalledTimes(1);
            const error = onError.mock.calls[0][0];
            expect(error).toBeInstanceOf(TRPCClientError);
        });
    });

    describe('subscription operations', () => {
        it('should stream multiple data yields without auto-completing', () => {
            const op = createMockOp('subscription', 'some.sub', 's-1');
            const { onNext, onComplete, simulateResponse } = createTestHarness(op);

            // First yield
            simulateResponse({ id: 's-1', result: { count: 0 } });
            expect(onNext).toHaveBeenCalledTimes(1);
            expect(onNext).toHaveBeenCalledWith({ result: { data: { count: 0 } } });
            // Subscription should NOT complete after data
            expect(onComplete).not.toHaveBeenCalled();

            // Second yield
            simulateResponse({ id: 's-1', result: { count: 1 } });
            expect(onNext).toHaveBeenCalledTimes(2);
            expect(onNext).toHaveBeenLastCalledWith({ result: { data: { count: 1 } } });
            expect(onComplete).not.toHaveBeenCalled();

            // Third yield
            simulateResponse({ id: 's-1', result: { count: 2 } });
            expect(onNext).toHaveBeenCalledTimes(3);
            expect(onComplete).not.toHaveBeenCalled();
        });

        it('should complete when a complete message is received', () => {
            const op = createMockOp('subscription', 'some.sub', 's-2');
            const { onNext, onComplete, simulateResponse } = createTestHarness(op);

            // Yield some data first
            simulateResponse({ id: 's-2', result: 'data1' });
            expect(onNext).toHaveBeenCalledTimes(1);

            // Server signals completion
            simulateResponse({ id: 's-2', complete: true });
            expect(onComplete).toHaveBeenCalledTimes(1);
        });

        it('should send subscription.stop when unsubscribed', () => {
            const op = createMockOp('subscription', 'some.sub', 's-3');
            const { sentMessages, subscription } = createTestHarness(op);

            // The initial send
            expect(sentMessages).toHaveLength(1);

            // Unsubscribe
            subscription.unsubscribe();

            // Should have sent a stop message
            expect(sentMessages).toHaveLength(2);
            expect(sentMessages[1].id).toBe('s-3');
            expect(sentMessages[1].op.type).toBe('subscription.stop');
            expect(sentMessages[1].op.path).toBe('some.sub');
        });
    });

    describe('cleanup behavior', () => {
        it('should call the onReceive unsubscribe function on cleanup', () => {
            const op = createMockOp('query', 'some.path', 'c-1');
            const { unsubscribeFn, subscription, simulateResponse } = createTestHarness(op);

            // Complete the query so the observable finishes
            simulateResponse({ id: 'c-1', result: 'done' });

            // Explicitly unsubscribe
            subscription.unsubscribe();

            expect(unsubscribeFn).toHaveBeenCalled();
        });

        it('should NOT send subscription.stop for query operations on cleanup', () => {
            const op = createMockOp('query', 'some.path', 'c-2');
            const { sentMessages, subscription, simulateResponse } = createTestHarness(op);

            simulateResponse({ id: 'c-2', result: 'done' });
            subscription.unsubscribe();

            // Only the initial send, no stop message
            expect(sentMessages).toHaveLength(1);
            expect(sentMessages[0].op.type).toBe('query');
        });

        it('should NOT send subscription.stop for mutation operations on cleanup', () => {
            const op = createMockOp('mutation', 'some.path', 'c-3');
            const { sentMessages, subscription, simulateResponse } = createTestHarness(op);

            simulateResponse({ id: 'c-3', result: 'ok' });
            subscription.unsubscribe();

            expect(sentMessages).toHaveLength(1);
            expect(sentMessages[0].op.type).toBe('mutation');
        });
    });

    describe('concurrent operations', () => {
        it('should correctly route messages to independent operations', () => {
            // Set up two concurrent operations with different IDs
            const op1 = createMockOp('query', 'path.one', 'concurrent-1');
            const op2 = createMockOp('query', 'path.two', 'concurrent-2');

            const sentMessages: VsCodeLinkRequestMessage[] = [];
            const send: Mock = vi.fn((msg: VsCodeLinkRequestMessage) => sentMessages.push(msg));

            const receiveCallbacks: Array<(message: VsCodeLinkResponseMessage) => void> = [];
            const onReceive: Mock = vi.fn((cb: (message: VsCodeLinkResponseMessage) => void) => {
                receiveCallbacks.push(cb);
                return vi.fn();
            });

            const link = vscodeLink<AnyRouter>({ send, onReceive });
            const linkRuntime = link({} as never);

            const onNext1: Mock = vi.fn();
            const onNext2: Mock = vi.fn();

            linkRuntime({ op: op1, next: (() => {}) as never } as never).subscribe({ next: onNext1 });
            linkRuntime({ op: op2, next: (() => {}) as never } as never).subscribe({ next: onNext2 });

            // Both operations should have been sent
            expect(sentMessages).toHaveLength(2);

            // Simulate response for op2 only — broadcast to all handlers
            for (const cb of receiveCallbacks) {
                cb({ id: 'concurrent-2', result: 'for-op2' });
            }

            // Only op2's observer should have received data
            expect(onNext1).not.toHaveBeenCalled();
            expect(onNext2).toHaveBeenCalledTimes(1);
            expect(onNext2).toHaveBeenCalledWith({ result: { data: 'for-op2' } });

            // Now respond to op1
            for (const cb of receiveCallbacks) {
                cb({ id: 'concurrent-1', result: 'for-op1' });
            }

            expect(onNext1).toHaveBeenCalledTimes(1);
            expect(onNext1).toHaveBeenCalledWith({ result: { data: 'for-op1' } });
            // op2 should still only have 1 call
            expect(onNext2).toHaveBeenCalledTimes(1);
        });
    });

    describe('abort signal operations', () => {
        it('should send an abort message when the signal is aborted after send', () => {
            const ac = new AbortController();
            const op = createMockOp('query', 'some.path', 'abort-1', ac.signal);
            const { sentMessages, onError } = createTestHarness(op);

            // The initial operation should have been sent
            expect(sentMessages).toHaveLength(1);
            expect(sentMessages[0].op.type).toBe('query');

            // Abort the signal
            ac.abort();

            // An abort message should have been sent
            expect(sentMessages).toHaveLength(2);
            expect(sentMessages[1].id).toBe('abort-1');
            expect(sentMessages[1].op.type).toBe('abort');
            expect(sentMessages[1].op.path).toBe('some.path');

            // The observer should have received an error
            expect(onError).toHaveBeenCalledTimes(1);
            const error = onError.mock.calls[0][0];
            expect(error).toBeInstanceOf(TRPCClientError);
            expect(error.message).toBe('Aborted');
        });

        it('should error immediately when the signal is already aborted', () => {
            const ac = new AbortController();
            ac.abort(); // Abort before creating the operation

            const op = createMockOp('query', 'some.path', 'abort-2', ac.signal);
            const { sentMessages, onError } = createTestHarness(op);

            // An abort message should have been sent (but NOT the original operation).
            // The abort message is the only one sent since signal was pre-aborted.
            expect(sentMessages.some((m) => m.op.type === 'abort')).toBe(true);

            // The observer should have received an error
            expect(onError).toHaveBeenCalledTimes(1);
            const error = onError.mock.calls[0][0];
            expect(error).toBeInstanceOf(TRPCClientError);
            expect(error.message).toBe('Aborted');
        });

        it('should send abort for mutations too', () => {
            const ac = new AbortController();
            const op = createMockOp('mutation', 'some.mutation', 'abort-3', ac.signal);
            const { sentMessages, onError } = createTestHarness(op);

            expect(sentMessages).toHaveLength(1);
            expect(sentMessages[0].op.type).toBe('mutation');

            ac.abort();

            expect(sentMessages).toHaveLength(2);
            expect(sentMessages[1].op.type).toBe('abort');

            expect(onError).toHaveBeenCalledTimes(1);
        });

        it('should not send abort message after cleanup/unsubscribe', () => {
            const ac = new AbortController();
            const op = createMockOp('query', 'some.path', 'abort-4', ac.signal);
            const { sentMessages, subscription, simulateResponse } = createTestHarness(op);

            // Complete the query
            simulateResponse({ id: 'abort-4', result: 'done' });
            subscription.unsubscribe();

            // Now abort — no abort message should be sent since the listener was cleaned up
            ac.abort();

            // Only the initial operation send should exist
            expect(sentMessages).toHaveLength(1);
            expect(sentMessages[0].op.type).toBe('query');
        });

        it('should still use subscription.stop for subscriptions, not abort', () => {
            const op = createMockOp('subscription', 'some.sub', 'abort-5');
            const { sentMessages, subscription } = createTestHarness(op);

            expect(sentMessages).toHaveLength(1);

            subscription.unsubscribe();

            // Should send subscription.stop, not abort
            expect(sentMessages).toHaveLength(2);
            expect(sentMessages[1].op.type).toBe('subscription.stop');
        });

        it('should not send abort when no signal is provided', () => {
            const op = createMockOp('query', 'some.path', 'abort-6');
            const { sentMessages, subscription, simulateResponse } = createTestHarness(op);

            simulateResponse({ id: 'abort-6', result: 'done' });
            subscription.unsubscribe();

            // Only the initial operation, no abort message
            expect(sentMessages).toHaveLength(1);
        });
    });
});
