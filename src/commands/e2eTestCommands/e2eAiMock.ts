/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared, control-file-driven AI mock engine for Playwright e2e tests.
 *
 * How it works
 * ------------
 * A single dispatcher resolver is installed onto the shared e2e mock language
 * model (see `setE2eMockResponseResolver` in `../../utils/aiUtils`). On every
 * `sendRequest` it reads a per-worker JSON **control file** written by the test
 * (`{ feature, route, delayMs }`), looks up the named feature's response
 * catalogue, applies any latency, and plays the route's responses back one per
 * request (clamping at the last).
 *
 * Why a control file (rather than a command per scenario)
 * -------------------------------------------------------
 * The Playwright worker and the extension host share the same per-worker
 * filesystem, so the test can express *any* scenario — route + latency — by
 * writing one small JSON file (mirroring the migration AI mock). This avoids a
 * separate argument-less palette command for every scenario and lets multiple
 * features (Generate Query, chat participant, …) reuse the exact same plumbing:
 * each registers its own {@link MockRouteCatalog} once via
 * {@link registerAiMockFeature} and the tests just name it in the control file.
 *
 * Visibility / safety
 * -------------------
 * Inert unless a control file exists in {@link AI_MOCK_DIR_ENV} (set only by the
 * Playwright fixture) AND the shared mock model is installed (e2e-only). Absent
 * either, the dispatcher streams nothing, so production is unaffected.
 */

import * as path from 'node:path';
import { type E2eMockResponseResolver, setE2eMockResponseResolver } from '../../utils/aiUtils';
import { delay, getFileMtimeMs, readJsonControlFile } from '../../utils/e2eControlFile';
import { type MockResponse } from '../../utils/languageModelMockUtils';

/** Per-worker directory (set by the Playwright fixture) holding {@link CONTROL_FILE}. */
const AI_MOCK_DIR_ENV = 'COSMOSDB_E2E_AI_MOCK_DIR';

/** Control-file name written by the test fixtures and read here per request. */
const CONTROL_FILE = 'ai-mock.json';

/**
 * One scripted response for a single `sendRequest`: a static payload, or a
 * function (for dynamic payloads that need the request args, e.g. token-aware).
 */
export type MockStep = MockResponse | E2eMockResponseResolver;

/**
 * A feature's response table: route id → the ordered responses the mock plays
 * back, one per `sendRequest`. Single-round routes are one-element lists;
 * multi-round flows (e.g. a tool call then a query) list each round in order.
 */
export type MockRouteCatalog = Record<string, readonly MockStep[]>;

/** Shape the test fixtures write into the control file. */
interface AiMockControl {
    /** Feature whose catalogue to dispatch to (see {@link registerAiMockFeature}). */
    feature?: string;
    /** Route within that feature's catalogue. */
    route?: string;
    /** Optional latency (ms) applied to every request — used to exercise Cancel. */
    delayMs?: number;
}

/** Registered feature catalogues, keyed by feature id. */
const catalogs = new Map<string, MockRouteCatalog>();

/**
 * Registers a feature's response catalogue. Call once at e2e activation. Tests
 * then select it by writing `{ feature }` into the control file.
 */
export function registerAiMockFeature(feature: string, catalog: MockRouteCatalog): void {
    catalogs.set(feature, catalog);
}

function controlFilePath(): string | undefined {
    const dir = process.env[AI_MOCK_DIR_ENV];
    return dir ? path.join(dir, CONTROL_FILE) : undefined;
}

// Index into the active route's response list, advanced per request. Reset to 0
// whenever the control file's mtime changes — i.e. when a test (re)selects a
// scenario — so multi-round routes restart cleanly at each new selection.
let responseIndex = 0;
let lastMtimeMs = -1;

function readControl(): AiMockControl {
    const file = controlFilePath();
    if (!file) {
        return {};
    }
    const mtimeMs = getFileMtimeMs(file) ?? -1;
    if (mtimeMs !== lastMtimeMs) {
        responseIndex = 0;
        lastMtimeMs = mtimeMs;
    }
    return readJsonControlFile<AiMockControl>(file) ?? {};
}

/**
 * The single resolver installed on the shared e2e mock. Reads the control file
 * per request, applies any latency, dispatches to the named feature's
 * catalogue, and plays the route's responses in order (clamping at the last).
 */
const dispatchResolver: E2eMockResponseResolver = async (args) => {
    const control = readControl();
    if (control.delayMs && control.delayMs > 0) {
        await delay(control.delayMs, args.token);
    }
    const catalog = control.feature ? catalogs.get(control.feature) : undefined;
    if (control.feature && !catalog) {
        throw new Error(
            `Unknown AI mock feature "${control.feature}". Did you register it with registerAiMockFeature()?`,
        );
    }

    const responses = control.route ? catalog?.[control.route] : undefined;
    if (control.feature && control.route && !responses) {
        throw new Error(`Unknown AI mock route "${control.route}" for feature "${control.feature}".`);
    }

    const steps = responses ?? [''];
    const step = steps[Math.min(responseIndex, steps.length - 1)];
    responseIndex++;
    return typeof step === 'function' ? step(args) : step;
};

/**
 * Installs the control-file dispatcher onto the shared e2e mock. Call once at
 * e2e activation. Safe to leave installed: it stays inert until both a control
 * file and the mock model override exist. E2e-only.
 */
export function installAiMockDispatcher(): void {
    setE2eMockResponseResolver(dispatchResolver);
}
