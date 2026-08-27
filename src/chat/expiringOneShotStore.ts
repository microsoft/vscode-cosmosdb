/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A small in-memory store of opaque, single-use handles that expire after a fixed time-to-live.
 *
 * Language-model tools use it to hand an immutable snapshot from one tool call (e.g. reading the
 * Query Editor context) to a later, separate tool call (e.g. executing or sampling) without relying
 * on ambient "active editor" state that the user can change in between. `create` mints a random id
 * for a value; `peek` reads it without consuming (used while building a confirmation prompt that may
 * never be confirmed); `take` reads and removes it so an id can authorize exactly one action.
 */
export interface ExpiringOneShotStore<T> {
    /** Stores `value` and returns a fresh opaque id that references it until taken or expired. */
    create(value: T): string;
    /** Returns the value for `id` without consuming it, or `undefined` when missing/expired. */
    peek(id: string): T | undefined;
    /** Returns the value for `id` and removes it, so the id can never be reused. */
    take(id: string): T | undefined;
}

export function createExpiringOneShotStore<T>(ttlMs: number): ExpiringOneShotStore<T> {
    interface Entry {
        value: T;
        expiresAt: number;
    }

    const entries = new Map<string, Entry>();

    function pruneExpired(now = Date.now()): void {
        for (const [id, entry] of entries) {
            if (entry.expiresAt <= now) {
                entries.delete(id);
            }
        }
    }

    function peek(id: string): T | undefined {
        const entry = entries.get(id);
        if (!entry) {
            return undefined;
        }
        if (entry.expiresAt <= Date.now()) {
            entries.delete(id);
            return undefined;
        }
        return entry.value;
    }

    return {
        create(value: T): string {
            pruneExpired();
            const id = globalThis.crypto.randomUUID();
            entries.set(id, { value, expiresAt: Date.now() + ttlMs });
            return id;
        },
        peek,
        take(id: string): T | undefined {
            const value = peek(id);
            entries.delete(id);
            return value;
        },
    };
}
