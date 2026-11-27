/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { vi } from 'vitest';
import { rejectOnTimeout, TimeoutError, valueOnTimeout, withAbortSignals } from './timeout';

describe('timeout Tests', () => {
    describe('withAbortSignals', () => {
        it.each([0, 1])('cancels when signal %i is aborted and removes listeners', async (index) => {
            const controllers = [new AbortController(), new AbortController()];
            const removals = controllers.map((controller) => vi.spyOn(controller.signal, 'removeEventListener'));
            const entered = Promise.withResolvers<AbortSignal>();
            const completed = Promise.withResolvers<string>();
            const result = withAbortSignals(
                controllers.map((controller) => controller.signal),
                (signal) => {
                    entered.resolve(signal);
                    return completed.promise;
                },
            );
            const signal = await entered.promise;

            controllers[index].abort();
            await expect(result).rejects.toMatchObject({ name: 'AbortError' });
            expect(signal.aborted).toBe(true);
            for (const removal of removals) {
                expect(removal).toHaveBeenCalledOnce();
            }
            completed.resolve('late result');
        });

        it('does not start an already-cancelled action', async () => {
            const first = new AbortController();
            const second = new AbortController();
            const removal = vi.spyOn(first.signal, 'removeEventListener');
            const action = vi.fn();
            second.abort();

            await expect(withAbortSignals([first.signal, second.signal], action)).rejects.toMatchObject({
                name: 'AbortError',
            });
            expect(action).not.toHaveBeenCalled();
            expect(removal).toHaveBeenCalledOnce();
        });

        it('unlinks signals after success without cancelling the completed action', async () => {
            const controller = new AbortController();
            const removal = vi.spyOn(controller.signal, 'removeEventListener');
            let actionSignal: AbortSignal | undefined;

            await expect(
                withAbortSignals([controller.signal], (signal) => {
                    actionSignal = signal;
                    return 'done';
                }),
            ).resolves.toBe('done');

            controller.abort();
            expect(actionSignal?.aborted).toBe(false);
            expect(removal).toHaveBeenCalledOnce();
        });

        it('preserves action errors and removes listeners', async () => {
            const controller = new AbortController();
            const removal = vi.spyOn(controller.signal, 'removeEventListener');
            const error = new Error('request failed');

            await expect(
                withAbortSignals([controller.signal], () => {
                    throw error;
                }),
            ).rejects.toBe(error);
            expect(removal).toHaveBeenCalledOnce();
        });

        it('does not start an action cancelled before its microtask runs', async () => {
            const controller = new AbortController();
            const action = vi.fn();
            const result = withAbortSignals([undefined, controller.signal], action);
            controller.abort();

            await expect(result).rejects.toMatchObject({ name: 'AbortError' });
            expect(action).not.toHaveBeenCalled();
        });

        it('handles a late action rejection after cancellation', async () => {
            const controller = new AbortController();
            const entered = Promise.withResolvers<void>();
            const completed = Promise.withResolvers<never>();
            const result = withAbortSignals([controller.signal], () => {
                entered.resolve();
                return completed.promise;
            });
            await entered.promise;
            controller.abort();
            await expect(result).rejects.toMatchObject({ name: 'AbortError' });

            completed.reject(new Error('late failure'));
            await new Promise<void>((resolve) => setImmediate(resolve));
        });
    });

    describe('rejectOnTimeout', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it('preserves the caller timeout message when cancellation rejects the action', async () => {
            vi.useFakeTimers();
            const result = rejectOnTimeout(
                30_000,
                (signal) =>
                    new Promise<never>((_resolve, reject) => {
                        signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
                    }),
                'Connection deadline exceeded',
            );
            const rejection = result.catch((error: unknown) => error);

            await vi.advanceTimersByTimeAsync(30_000);
            await expect(rejection).resolves.toMatchObject({
                name: 'TimeoutError',
                message: 'Connection deadline exceeded',
            });
            expect(vi.getTimerCount()).toBe(0);
        });

        it('clears the deadline after early success without aborting', async () => {
            vi.useFakeTimers();
            let signal: AbortSignal | undefined;
            const result = rejectOnTimeout(30_000, (abortSignal) => {
                signal = abortSignal;
                return 'done';
            });

            await expect(result).resolves.toBe('done');
            expect(vi.getTimerCount()).toBe(0);
            await vi.advanceTimersByTimeAsync(30_000);
            expect(signal?.aborted).toBe(false);
        });

        it('clears the deadline after early failure without aborting', async () => {
            vi.useFakeTimers();
            let signal: AbortSignal | undefined;
            const error = new Error('action failed');
            const result = rejectOnTimeout(30_000, (abortSignal) => {
                signal = abortSignal;
                throw error;
            });

            await expect(result).rejects.toBe(error);
            expect(vi.getTimerCount()).toBe(0);
            await vi.advanceTimersByTimeAsync(30_000);
            expect(signal?.aborted).toBe(false);
        });

        it('aborts the action when the deadline expires and preserves the timeout error', async () => {
            let signal: AbortSignal | undefined;
            const result = rejectOnTimeout(1, (abortSignal) => {
                signal = abortSignal;
                return new Promise(() => {});
            });

            await expect(result).rejects.toBeInstanceOf(TimeoutError);
            expect(signal?.aborted).toBe(true);
        });

        it('executes synchronously', async () => {
            let executed: boolean = false;

            await rejectOnTimeout(1, () => {
                executed = true;
            });

            expect(executed).toBe(true);
        });

        it('executes synchronously in promise', async () => {
            let executed = false;

            await rejectOnTimeout(1, () => {
                return new Promise<void>((resolve, _reject) => {
                    executed = true;
                    resolve();
                });
            });

            expect(executed).toBe(true);
        });

        it('executes asynchronously before time-out', async () => {
            let executed = false;

            await rejectOnTimeout(1000, () => {
                return new Promise<void>((resolve, _reject) => {
                    setTimeout(() => {
                        executed = true;
                        resolve();
                    }, 1);
                });
            });

            expect(executed).toBe(true);
        });

        it('timed out', async () => {
            let executed = false;

            await expect(
                rejectOnTimeout(1, async () => {
                    await new Promise<void>((resolve, _reject) => {
                        setTimeout(() => {
                            executed = true;
                            resolve();
                        }, 1000);
                    });
                }),
            ).rejects.toThrow('Execution timed out');

            expect(executed).toBe(false);
        });

        it('throws before time-out', async () => {
            const executed = false;
            let error: Error = new Error("I haven't thrown up yet");

            try {
                await rejectOnTimeout(1000, async () => {
                    await new Promise((_resolve, _reject) => {
                        throw new Error('I threw up');
                    });
                });
            } catch (err) {
                error = err as Error;
            }

            expect(executed).toBe(false);
            expect(error.message).toEqual('I threw up');
        });
    });

    describe('valueOnTimeout', () => {
        it('executed', async () => {
            const value = await valueOnTimeout(1000, 123, async () => {
                return new Promise<number>((resolve, _reject) => {
                    setTimeout(() => {
                        resolve(-123);
                    }, 1);
                });
            });

            expect(value).toEqual(-123);
        });

        it('timed out', async () => {
            const value = await valueOnTimeout(1, 123, async () => {
                return new Promise<number>((resolve, _reject) => {
                    setTimeout(() => {
                        resolve(-123);
                    }, 1000);
                });
            });

            expect(value).toEqual(123);
        });

        it('reject', async () => {
            await expect(
                valueOnTimeout(1000, 123, async () => {
                    return new Promise<number>((_resolve, reject) => {
                        setTimeout(() => {
                            reject(new Error('rejected'));
                        }, 1);
                    });
                }),
            ).rejects.toThrow('rejected');
        });
    });
});
