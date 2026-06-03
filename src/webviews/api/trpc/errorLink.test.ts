/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AnyRouter } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { vi, type Mock } from 'vitest';
import { errorLink, type ErrorHandler } from './errorLink';

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

function createTestHarness(
    type: 'query' | 'mutation' | 'subscription',
    outcome: DownstreamOutcome,
    onErrorHandler: (err: Error) => void,
) {
    const link = errorLink<AnyRouter>(onErrorHandler);
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

    return { onNext, onError, onComplete };
}

describe('errorLink', () => {
    it('forwards query errors to the consumer onError handler', () => {
        const handler = vi.fn() as Mock & ErrorHandler;
        const { onError } = createTestHarness('query', { kind: 'error', error: new Error('boom') }, handler);

        expect(handler).toHaveBeenCalledTimes(1);
        const forwarded = handler.mock.calls[0][0];
        expect(forwarded).toBeInstanceOf(Error);
        expect(forwarded.message).toBe('boom');

        // The error is re-emitted downstream so call-site .catch handlers still fire.
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('forwards mutation errors to the consumer onError handler', () => {
        const handler = vi.fn() as Mock & ErrorHandler;
        const { onError } = createTestHarness('mutation', { kind: 'error', error: new Error('nope') }, handler);

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].message).toBe('nope');
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('normalises non-Error rejections into Error instances', () => {
        const handler = vi.fn() as Mock & ErrorHandler;
        createTestHarness('query', { kind: 'error', error: 'string failure' }, handler);

        expect(handler).toHaveBeenCalledTimes(1);
        const forwarded = handler.mock.calls[0][0];
        expect(forwarded).toBeInstanceOf(Error);
        expect(forwarded.message).toBe('string failure');
    });

    it('does not forward subscription errors to the consumer handler', () => {
        const handler = vi.fn() as Mock & ErrorHandler;
        const { onError } = createTestHarness('subscription', { kind: 'error', error: new Error('sub') }, handler);

        // Subscriptions have their own per-call onError hook; this link must
        // not double-report them through the consumer's global handler.
        expect(handler).not.toHaveBeenCalled();

        // The error still propagates down the link chain so the subscription's
        // own onError callback can react.
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('passes through successful values without invoking the handler', () => {
        const handler = vi.fn() as Mock & ErrorHandler;
        const { onNext, onError, onComplete } = createTestHarness(
            'query',
            { kind: 'next', value: { result: { data: 'ok' } } },
            handler,
        );

        expect(handler).not.toHaveBeenCalled();
        expect(onNext).toHaveBeenCalledWith({ result: { data: 'ok' } });
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
    });

    it('passes through complete signals without invoking the handler', () => {
        const handler = vi.fn() as Mock & ErrorHandler;
        const { onComplete, onError } = createTestHarness('query', { kind: 'complete' }, handler);

        expect(handler).not.toHaveBeenCalled();
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
    });
});
