/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Local, migration-feature-only adapter that gives the migration step files a
 * minimal `Channel`-shaped interface for emitting events to the webview, while
 * the actual transport is the new tRPC subscription (a TypedEventSink).
 *
 * This is intentionally NOT a restoration of the global Channel architecture
 * that PR #2982 removed. It is a one-direction adapter (ext → webview events)
 * scoped to the migration feature so we don't have to rewrite every event-
 * emission call site inside the long step files. webview→ext communication
 * goes through real tRPC procedures.
 */

import { type TypedEventSink } from '../../utils/TypedEventSink';
import { type MigrationEvent } from '../trpc/routers/migrationEventsRouter';

/**
 * Subset of the old ChannelPayload union still used by the migration step
 * files. Only the 'event' variant is supported — request/response/error are
 * not used by the migration code.
 */
export type MigrationChannelPayload = {
    type: 'event';
    name: string;
    params: unknown[];
};

/**
 * Minimal Channel-shaped facade. Only `postMessage` is exposed; that is all
 * the migration step files use.
 */
export interface Channel {
    postMessage(message: MigrationChannelPayload): Promise<void>;
}

/**
 * Concrete adapter backed by a tRPC TypedEventSink. The webview receives the
 * emitted events through the `migration.events` subscription.
 */
export class MigrationEventChannel implements Channel {
    constructor(private readonly sink: TypedEventSink<MigrationEvent>) {}

    public async postMessage(message: MigrationChannelPayload): Promise<void> {
        this.sink.emit({ type: 'event', name: message.name, params: message.params });
    }
}
