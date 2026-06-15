/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AnyRouter } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { vi, type Mock } from 'vitest';
import { errorLink } from './errorLink';
import { createEventChannel, type RpcEventEmitter } from './events';

/**
 * Build a downstream link that emits one of: `next` value, `error`, or
 * `complete`, so tests can drive each branch of the link wrapper.
 */
type DownstreamOutcome =
    | { kind: 'next'; value: { result: { data: unknown } } }
    | { kind: 'error'; error: unknown }
    | { kind: 'complete' };

function makeDownstreamNext(outcome: DownstreamOutcome) {
    return () =>
        observable<{ result: { data: unknown } }, unknown>((observer) => {
            if (outcome.kind === 'next') {
                observer.next(outcome.value);
                observer.complete();
            } else if (outcome.kind === 'error') {
                observer.error(outcome.error);
            } else {
                observer.complete();
            }
            return () => void 0;
        });
}

interface Harness {
    onNext: Mock;
    onError: Mock;
    onComplete: Mock;
    events: RpcEventEmitter;
    success: Mock;
    error: Mock;
    aborted: Mock;
}

function createTestHarness(type: 'query' | 'mutation' | 'subscription', outcome: DownstreamOutcome): Harness {
    const events = createEventChannel();
    const success = vi.fn();
    const error = vi.fn();
    const aborted = vi.fn();
    events.onSuccess(success);
    events.onError(error);
    events.onAborted(aborted);

    const link = errorLink<AnyRouter>(events);
    const linkRuntime = link({} as never);

    const op = {
        id: 0,
        type,
        path: 'demo.someProcedure',
        input: undefined,
        context: { trpc: { requestId: 'r-1' } },
        signal: null,
    };

    const next = makeDownstreamNext(outcome);
    const obs = linkRuntime({ op, next } as never);

    const onNext: Mock = vi.fn();
    const onError: Mock = vi.fn();
    const onComplete: Mock = vi.fn();
    obs.subscribe({ next: onNext, error: onError, complete: onComplete });

    return { onNext, onError, onComplete, events, success, error, aborted };
}

describe('errorLink', () => {
    describe('errors', () => {
        it('forwards query errors to channel onError subscribers', () => {
            const h = createTestHarness('query', { kind: 'error', error: new Error('boom') });

            expect(h.error).toHaveBeenCalledTimes(1);
            const [forwarded, info] = h.error.mock.calls[0] as [Error, { type: string; path: string }];
            expect(forwarded).toBeInstanceOf(Error);
            expect(forwarded.message).toBe('boom');
            expect(info).toEqual({ type: 'query', path: 'demo.someProcedure' });

            // The error is re-emitted downstream so call-site .catch handlers still fire.
            expect(h.onError).toHaveBeenCalledTimes(1);
            // Aborted/success channels are not touched for a plain error.
            expect(h.aborted).not.toHaveBeenCalled();
            expect(h.success).not.toHaveBeenCalled();
        });

        it('forwards mutation errors to channel onError subscribers', () => {
            const h = createTestHarness('mutation', { kind: 'error', error: new Error('nope') });

            expect(h.error).toHaveBeenCalledTimes(1);
            expect(h.error.mock.calls[0][1]).toEqual({ type: 'mutation', path: 'demo.someProcedure' });
            expect(h.onError).toHaveBeenCalledTimes(1);
        });

        it('normalises non-Error rejections into Error instances', () => {
            const h = createTestHarness('query', { kind: 'error', error: 'string failure' });

            expect(h.error).toHaveBeenCalledTimes(1);
            const forwarded = h.error.mock.calls[0][0] as Error;
            expect(forwarded).toBeInstanceOf(Error);
            expect(forwarded.message).toBe('string failure');
        });

        it('does not publish subscription errors to the channel', () => {
            const h = createTestHarness('subscription', { kind: 'error', error: new Error('sub') });

            // Subscriptions have their own per-call onError hook; this link must
            // not double-report them through the central channel.
            expect(h.error).not.toHaveBeenCalled();
            expect(h.aborted).not.toHaveBeenCalled();
            // The error still propagates down the link chain so the subscription's
            // own onError callback can react.
            expect(h.onError).toHaveBeenCalledTimes(1);
        });
    });

    describe('aborts', () => {
        it('routes top-level AbortError to onAborted, never to onError', () => {
            const abortErr = Object.assign(new Error('Aborted'), { name: 'AbortError' });
            const h = createTestHarness('query', { kind: 'error', error: abortErr });

            expect(h.aborted).toHaveBeenCalledTimes(1);
            expect(h.aborted.mock.calls[0][0]).toEqual({ type: 'query', path: 'demo.someProcedure' });
            expect(h.error).not.toHaveBeenCalled();
            // Always re-emitted downstream.
            expect(h.onError).toHaveBeenCalledTimes(1);
        });

        it('detects AbortError nested in cause (TRPCClientError wrapping)', () => {
            const cause = Object.assign(new Error('Aborted'), { name: 'AbortError' });
            const wrapped = Object.assign(new Error('TRPCClientError'), { cause });
            const h = createTestHarness('mutation', { kind: 'error', error: wrapped });

            expect(h.aborted).toHaveBeenCalledTimes(1);
            expect(h.error).not.toHaveBeenCalled();
        });

        it('does not publish subscription aborts to the channel', () => {
            const abortErr = Object.assign(new Error('Aborted'), { name: 'AbortError' });
            const h = createTestHarness('subscription', { kind: 'error', error: abortErr });

            expect(h.aborted).not.toHaveBeenCalled();
            expect(h.error).not.toHaveBeenCalled();
            expect(h.onError).toHaveBeenCalledTimes(1);
        });

        it('silently drops aborts when there are no onAborted subscribers', () => {
            const events = createEventChannel();
            const error = vi.fn();
            events.onError(error);

            const link = errorLink<AnyRouter>(events);
            const linkRuntime = link({} as never);
            const abortErr = Object.assign(new Error('Aborted'), { name: 'AbortError' });
            const obs = linkRuntime({
                op: { id: 0, type: 'query', path: 'p', input: undefined, context: {}, signal: null },
                next: makeDownstreamNext({ kind: 'error', error: abortErr }),
            } as never);

            const onError = vi.fn();
            obs.subscribe({ next: vi.fn(), error: onError, complete: vi.fn() });

            // Abort dropped at channel; onError never fired.
            expect(error).not.toHaveBeenCalled();
            // Call-site still sees the rejection.
            expect(onError).toHaveBeenCalledTimes(1);
        });
    });

    describe('successes', () => {
        it('publishes query success with extracted data to channel onSuccess', () => {
            const h = createTestHarness('query', { kind: 'next', value: { result: { data: 'ok' } } });

            expect(h.success).toHaveBeenCalledTimes(1);
            const [info, data] = h.success.mock.calls[0] as [{ type: string; path: string }, unknown];
            expect(info).toEqual({ type: 'query', path: 'demo.someProcedure' });
            expect(data).toBe('ok');

            expect(h.onNext).toHaveBeenCalledWith({ result: { data: 'ok' } });
            expect(h.onComplete).toHaveBeenCalledTimes(1);
            expect(h.onError).not.toHaveBeenCalled();
            expect(h.error).not.toHaveBeenCalled();
        });

        it('does not publish subscription emissions to the channel', () => {
            // Subscriptions emit values too, but we deliberately skip success
            // publication for them — they have their own onData.
            const h = createTestHarness('subscription', { kind: 'next', value: { result: { data: 1 } } });

            expect(h.success).not.toHaveBeenCalled();
            expect(h.onNext).toHaveBeenCalledTimes(1);
        });

        it('passes through complete signals without publishing anything', () => {
            const h = createTestHarness('query', { kind: 'complete' });

            expect(h.success).not.toHaveBeenCalled();
            expect(h.error).not.toHaveBeenCalled();
            expect(h.aborted).not.toHaveBeenCalled();
            expect(h.onComplete).toHaveBeenCalledTimes(1);
            expect(h.onError).not.toHaveBeenCalled();
        });
    });

    describe('pub-sub semantics', () => {
        it('delivers each event to multiple subscribers', () => {
            const events = createEventChannel();
            const a = vi.fn();
            const b = vi.fn();
            const c = vi.fn();
            events.onError(a);
            events.onError(b);
            events.onError(c);

            const link = errorLink<AnyRouter>(events);
            const linkRuntime = link({} as never);
            const obs = linkRuntime({
                op: { id: 0, type: 'query', path: 'p', input: undefined, context: {}, signal: null },
                next: makeDownstreamNext({ kind: 'error', error: new Error('x') }),
            } as never);
            obs.subscribe({ next: vi.fn(), error: vi.fn(), complete: vi.fn() });

            expect(a).toHaveBeenCalledTimes(1);
            expect(b).toHaveBeenCalledTimes(1);
            expect(c).toHaveBeenCalledTimes(1);
        });

        it('returns idempotent unsubscribe from on* methods', () => {
            const events = createEventChannel();
            const handler = vi.fn();
            const off = events.onError(handler);
            off();
            off(); // second call is a no-op
            events.emitError(new Error('x'), { type: 'query', path: 'p' });
            expect(handler).not.toHaveBeenCalled();
        });

        it('isolates exceptions thrown by one handler from siblings', () => {
            const events = createEventChannel();
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => void 0);
            const bad = vi.fn(() => {
                throw new Error('bad subscriber');
            });
            const good = vi.fn();
            events.onError(bad);
            events.onError(good);

            events.emitError(new Error('x'), { type: 'query', path: 'p' });

            expect(bad).toHaveBeenCalledTimes(1);
            expect(good).toHaveBeenCalledTimes(1);
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it('allows a subscriber to unsubscribe during dispatch without affecting siblings', () => {
            const events = createEventChannel();
            const order: string[] = [];
            // Use a ref object so the closure can see the unsubscribe function
            // that's only known *after* `events.onError(a)` returns.
            const offRef: { current: (() => void) | undefined } = { current: undefined };
            const a = vi.fn(() => {
                order.push('a');
                offRef.current?.();
            });
            const b = vi.fn(() => order.push('b'));
            offRef.current = events.onError(a);
            events.onError(b);

            events.emitError(new Error('x'), { type: 'query', path: 'p' });

            expect(order).toEqual(['a', 'b']);
            // After unsubscription, a no longer fires.
            events.emitError(new Error('y'), { type: 'query', path: 'p' });
            expect(a).toHaveBeenCalledTimes(1);
            expect(b).toHaveBeenCalledTimes(2);
        });
    });
});
