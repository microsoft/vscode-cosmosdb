/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Playwright globalTeardown: removes the run-scoped temp directory created
 * by `helpers/e2eIsolation.ts` and tears down the Cosmos DB emulator —
 * but only when `globalSetup` actually succeeded in starting it
 * (tracked via the ownership marker file). This avoids noisy
 * "docker daemon unavailable" errors when the suite never managed to
 * spawn the container in the first place.
 *
 * Results and reports directories are kept — developers (and CI) need
 * them after the run ends.
 */

import { existsSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureE2eIsolationContext } from '../helpers/e2eIsolation';
import { clearEmulatorOwnership, isEmulatorOwned, isEmulatorSkipped, stopEmulator } from './emulator';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

export default function globalTeardown(): void {
    if (!isEmulatorSkipped() && isEmulatorOwned(repoRoot)) {
        try {
            stopEmulator();
        } catch (err) {
            // Don't fail the run because of teardown — the next `docker compose
            // up` will surface a real failure if the container is wedged.
            console.warn(`[e2e teardown] Failed to stop emulator: ${(err as Error).message}`);
        }
        clearEmulatorOwnership(repoRoot);
    }

    const isolation = ensureE2eIsolationContext();
    if (!existsSync(isolation.tempRootDir)) return;
    try {
        rmSync(isolation.tempRootDir, { recursive: true, force: true });
        console.log(`[e2e teardown] Removed temp root: ${isolation.tempRootDir}`);
    } catch (err) {
        console.warn(`[e2e teardown] Failed to remove ${isolation.tempRootDir}: ${(err as Error).message}`);
    }
}
