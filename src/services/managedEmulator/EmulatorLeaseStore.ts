/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import path from 'path';
import { lock } from 'proper-lockfile';
import { z } from 'zod';
import { containerEngines, EmulatorError, stages, validPorts, type EmulatorLease } from './model';

const persistedLease = z.object({
    id: z.uuid(),
    volumeOperation: z.uuid(),
    containerOperation: z.uuid(),
    engineId: z.string().min(1),
    engine: z.enum(containerEngines),
    ports: z.object({ endpoint: z.number(), explorer: z.number() }).refine(validPorts),
    phase: z.enum(['provisioning', 'waiting', 'ready', 'rollback', 'deleting']),
    newVolume: z.boolean(),
    stage: z.enum(stages),
});

export interface EmulatorLeaseStore {
    read(): Promise<EmulatorLease | undefined>;
    write(lease: EmulatorLease | undefined): Promise<void>;
    exclusive<T>(operation: (assertExclusive: () => void) => Promise<T>): Promise<T>;
}

export class FileEmulatorLeaseStore implements EmulatorLeaseStore {
    public constructor(private readonly directory: string) {}

    private get file(): string {
        return path.join(this.directory, 'managed-emulator.json');
    }

    public async read(): Promise<EmulatorLease | undefined> {
        let contents: string;
        try {
            contents = await readFile(this.file, 'utf8');
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
            throw new EmulatorError('storage');
        }
        try {
            return persistedLease.parse(JSON.parse(contents));
        } catch {
            throw new EmulatorError('storage');
        }
    }

    public async write(lease: EmulatorLease | undefined): Promise<void> {
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        try {
            if (!lease) {
                await rm(this.file, { force: true });
                return;
            }
            await writeFile(temporary, JSON.stringify(lease), { flag: 'wx', mode: 0o600, flush: true });
            await rename(temporary, this.file);
        } catch {
            await rm(temporary, { force: true });
            throw new EmulatorError('storage');
        }
    }

    public async exclusive<T>(operation: (assertExclusive: () => void) => Promise<T>): Promise<T> {
        let release: () => Promise<void>;
        let compromised = false;
        try {
            await mkdir(this.directory, { recursive: true });
            release = await lock(this.file, {
                realpath: false,
                stale: 120_000,
                update: 5_000,
                onCompromised: () => {
                    compromised = true;
                },
            });
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ELOCKED') throw new EmulatorError('busy');
            throw new EmulatorError('storage');
        }
        const assertExclusive = () => {
            if (compromised) throw new EmulatorError('busy');
        };
        try {
            return await operation(assertExclusive);
        } finally {
            if (!compromised) await release();
        }
    }
}
