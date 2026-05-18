/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TRPCClient } from '@trpc/client';
import { type MigrationAppRouter } from '../../../../panels/trpc/appRouter';

/**
 * Webview-side Channel adapter for the Migration Assistant.
 *
 * Bridges the legacy Channel API (`.on(name, handler)` + `.postMessage(...)`)
 * onto the new tRPC transport so the large body of existing Migration webview
 * code that consumes Channel can be kept untouched. The adapter:
 *
 * - Subscribes to the `migration.events` tRPC subscription and dispatches
 *   incoming events to handlers registered via `.on()`.
 * - Maps `.postMessage({type:'event', name:'command', params:[{commandName, params}]})`
 *   onto the `migration.command` tRPC mutation.
 *
 * This is an internal compatibility shim, scoped to the migration feature
 * only. New code should call the tRPC client directly.
 */

export type ChannelEventHandler = (...args: never[]) => void;

export interface ChannelDisposable {
    dispose(): void;
}

export interface Channel {
    on(name: string, handler: ChannelEventHandler): ChannelDisposable;
    postMessage(message: { type: 'event'; name: string; params: unknown[] }): Promise<void>;
}

export class MigrationChannel implements Channel {
    private readonly handlers = new Map<string, Set<ChannelEventHandler>>();
    private subscription: { unsubscribe(): void } | undefined;

    constructor(private readonly trpcClient: TRPCClient<MigrationAppRouter>) {
        // oxlint-disable-next-line typescript/no-unsafe-call, typescript/no-unsafe-member-access -- generic tRPC client typings
        this.subscription = (
            trpcClient as unknown as {
                migration: {
                    events: {
                        subscribe: (
                            input: undefined,
                            opts: { onData: (event: { type: 'event'; name: string; params: unknown[] }) => void },
                        ) => { unsubscribe(): void };
                    };
                };
            }
        ).migration.events.subscribe(undefined, {
            onData: (event) => {
                const set = this.handlers.get(event.name);
                if (!set) return;
                for (const handler of set) {
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                        (handler as (...a: unknown[]) => void)(...event.params);
                    } catch (e) {
                        console.error(`[MigrationChannel] handler for '${event.name}' threw:`, e);
                    }
                }
            },
        });
    }

    public on(name: string, handler: ChannelEventHandler): ChannelDisposable {
        let set = this.handlers.get(name);
        if (!set) {
            set = new Set();
            this.handlers.set(name, set);
        }
        set.add(handler);
        return {
            dispose: () => {
                const current = this.handlers.get(name);
                if (!current) return;
                current.delete(handler);
                if (current.size === 0) this.handlers.delete(name);
            },
        };
    }

    public async postMessage(message: { type: 'event'; name: string; params: unknown[] }): Promise<void> {
        if (message.name !== 'command') {
            console.warn(`[MigrationChannel] Ignoring postMessage with name '${message.name}'`);
            return;
        }
        const wrapper = message.params[0] as { commandName: string; params: unknown[] } | undefined;
        if (!wrapper || typeof wrapper.commandName !== 'string') {
            console.warn('[MigrationChannel] Malformed command payload:', message);
            return;
        }
        // oxlint-disable-next-line typescript/no-unsafe-member-access, typescript/no-unsafe-call -- generic tRPC client typings
        await (
            this.trpcClient as unknown as {
                migration: {
                    command: { mutate: (input: { commandName: string; params: unknown[] }) => Promise<unknown> };
                };
            }
        ).migration.command.mutate({ commandName: wrapper.commandName, params: wrapper.params ?? [] });
    }

    public dispose(): void {
        this.subscription?.unsubscribe();
        this.subscription = undefined;
        this.handlers.clear();
    }
}
