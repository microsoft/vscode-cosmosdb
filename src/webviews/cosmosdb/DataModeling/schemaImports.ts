/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DataModel } from './dataModel';
import { type SchemaProperty } from './models';

/** A confirmed JSON schema import targeting one container. */
export interface SchemaImport {
    readonly containerId: string;
    readonly fileName: string;
    /** The inferred properties, set once the file is parsed and before the model update is queued. */
    properties?: SchemaProperty[];
    reported: boolean;
}

/**
 * Tracks the latest schema import per container. The wizard owns one instance so tracking survives Data-page
 * remounts: a newer import supersedes an older pending read, and success is acknowledged only after commit.
 */
export class SchemaImportTracker {
    private readonly latest = new Map<string, SchemaImport>();

    /** Starts an import for a container, superseding any earlier import for it. */
    start(containerId: string, fileName: string): SchemaImport {
        const request: SchemaImport = { containerId, fileName, reported: false };
        this.latest.set(containerId, request);
        return request;
    }

    isCurrent(request: SchemaImport): boolean {
        return this.latest.get(request.containerId) === request;
    }

    /**
     * Forgets imports whose container no longer exists and returns the imports newly committed in `model`.
     * Each import is returned once, to whichever owner observes its commit first.
     */
    acknowledge(model: DataModel): SchemaImport[] {
        const committed: SchemaImport[] = [];
        for (const [containerId, request] of this.latest) {
            const container = model.containers.find((c) => c.id === containerId);
            if (!container) {
                this.latest.delete(containerId);
            } else if (!request.reported && request.properties && container.properties === request.properties) {
                request.reported = true;
                committed.push(request);
            }
        }
        return committed;
    }
}
