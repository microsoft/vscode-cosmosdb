/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Utility type for events that use a `type` discriminator field.
 * All event unions used with TypedEventSink must extend this shape.
 */
export type DiscriminatedEvent = { type: string };

/**
 * Given a discriminated event union T and one of its type tags K,
 * extracts the matching member of the union.
 */
export type EventOfType<T extends DiscriminatedEvent, K extends T['type']> = Extract<T, { type: K }>;

/**
 * Write-only interface for emitting events into a TypedEventSink.
 * Used by session factories that need to emit a subset of events
 * into sinks with different full event unions (e.g., DocumentEvent or QueryEditorEvent).
 */
export interface UntypedEventEmitter {
    emit(event: { type: string; [key: string]: unknown }): void;
}

/**
 * A typed async-iterable event emitter that bridges imperative `emit()` calls
 * into the async generator consumed by tRPC subscriptions.
 *
 * Usage:
 * - The server (extension) calls `emit(event)` to push typed events.
 * - The tRPC subscription procedure iterates with `for await (const event of sink)`.
 * - Call `close()` when the tab/session is disposed to complete the iterator.
 */
export class TypedEventSink<T extends DiscriminatedEvent> implements AsyncIterable<T> {
    private queue: T[] = [];
    private resolve: ((value: IteratorResult<T>) => void) | null = null;
    private done = false;
    private iterating = false;

    /**
     * Push a typed event into the sink. If a consumer is waiting, it receives
     * the event immediately. Otherwise the event is buffered.
     *
     * Overload 1: Pass the full event object (discriminated union member).
     * Overload 2: Pass the event type tag and payload separately for better autocompletion.
     *
     * Events emitted after `close()` are silently dropped.
     */
    emit(event: T): void;
    emit<K extends T['type']>(type: K, payload: Omit<EventOfType<T, K>, 'type'>): void;
    emit<K extends T['type']>(eventOrType: T | K, payload?: Omit<EventOfType<T, K>, 'type'>): void {
        if (this.done) {
            return;
        }

        const event: T =
            typeof eventOrType === 'string' ? ({ type: eventOrType, ...payload } as unknown as T) : eventOrType;

        if (this.resolve) {
            const res = this.resolve;
            this.resolve = null;
            res({ value: event, done: false });
        } else {
            this.queue.push(event);
        }
    }

    /**
     * Close the sink. The async iterator will complete after all buffered
     * events have been consumed. No further events can be emitted.
     */
    close(): void {
        this.done = true;

        if (this.resolve) {
            const res = this.resolve;
            this.resolve = null;
            res({ value: undefined as unknown as T, done: true });
        }
    }

    /**
     * Whether the sink has been closed.
     */
    get isClosed(): boolean {
        return this.done;
    }

    [Symbol.asyncIterator](): AsyncIterator<T> {
        if (this.iterating) {
            throw new Error('TypedEventSink supports only a single consumer');
        }
        this.iterating = true;

        return {
            next: (): Promise<IteratorResult<T>> => {
                // Drain buffered events first
                if (this.queue.length > 0) {
                    return Promise.resolve({ value: this.queue.shift()!, done: false });
                }

                // If closed and buffer is empty, signal completion
                if (this.done) {
                    return Promise.resolve({ value: undefined as unknown as T, done: true });
                }

                // Wait for the next emit() or close()
                return new Promise<IteratorResult<T>>((resolve) => {
                    this.resolve = resolve;
                });
            },
        };
    }
}
