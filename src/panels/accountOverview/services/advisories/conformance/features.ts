/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateMessages } from '@cucumber/gherkin';
import { IdGenerator, SourceMediaType, type Pickle } from '@cucumber/messages';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export interface FeatureCase {
    detector: string;
    file: string;
    pickle: Pickle;
}

export function parseFeature(source: string, file: string): FeatureCase[] {
    const detector = /^dx(\d{3})_.*\.feature$/i.exec(path.basename(file));
    if (!detector) {
        throw new Error(`Unknown CODA feature filename: ${path.basename(file)}`);
    }
    const messages = generateMessages(source, file, SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN, {
        includePickles: true,
        newId: IdGenerator.incrementing(),
    });
    const errors = messages.flatMap((message) => (message.parseError ? [message.parseError.message] : []));
    if (errors.length > 0) {
        throw new Error(`Invalid Gherkin in ${path.basename(file)}: ${errors.join('; ')}`);
    }
    const cases = messages.flatMap((message) =>
        message.pickle ? [{ detector: `DX-${detector[1]}`, file, pickle: message.pickle }] : [],
    );
    if (cases.length === 0) {
        throw new Error(`No executable scenarios in ${path.basename(file)}.`);
    }
    return cases;
}

export function loadFeatures(directory: string): FeatureCase[] {
    const cases: FeatureCase[] = [];
    function visit(folder: string): void {
        if (lstatSync(folder).isSymbolicLink()) {
            throw new Error('CODA feature directories must not be symbolic links.');
        }
        for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const file = path.join(folder, entry.name);
            if (entry.isSymbolicLink()) {
                throw new Error('CODA feature paths must not be symbolic links.');
            }
            if (entry.isDirectory()) {
                visit(file);
            } else if (entry.isFile() && entry.name.endsWith('.feature')) {
                cases.push(...parseFeature(readFileSync(file, 'utf8'), file));
            }
        }
    }
    visit(directory);
    if (cases.length === 0) {
        throw new Error('No CODA scenarios found.');
    }
    return cases;
}
