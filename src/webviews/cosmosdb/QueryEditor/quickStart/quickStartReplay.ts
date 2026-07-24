/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Lightweight, dependency-free signal the Quick Start tour uses to let any part
 * of the webview (e.g. a toolbar button or a command relayed from the extension
 * host) request a manual replay of the tour.
 *
 * An optional `group` narrows the replay to a single group of tips; when it is
 * omitted the whole tour (every group, in order) is replayed.
 *
 * A plain `EventTarget` is used instead of React context so the trigger does not
 * need to live inside the provider's subtree.
 */

const REPLAY_EVENT = 'cosmosdb.quickStart.replay';

const bus = new EventTarget();

/**
 * Requests a manual replay of the Quick Start tour. Pass a `group` id to replay
 * just that group; omit it to replay every group in order.
 */
export function requestQuickStartReplay(group?: string): void {
    bus.dispatchEvent(new CustomEvent(REPLAY_EVENT, { detail: group ?? null }));
}

/**
 * Subscribes to manual replay requests. The listener receives the requested
 * group id, or `null` to replay the whole tour. Returns an unsubscribe function.
 */
export function onQuickStartReplay(listener: (group: string | null) => void): () => void {
    const handler = (event: Event) => listener((event as CustomEvent<string | null>).detail ?? null);
    bus.addEventListener(REPLAY_EVENT, handler);
    return () => bus.removeEventListener(REPLAY_EVENT, handler);
}
