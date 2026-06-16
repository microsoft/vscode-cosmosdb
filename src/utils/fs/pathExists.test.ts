/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'node:fs/promises';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import { pathExists } from './pathExists';

vi.mock('node:fs/promises', () => ({
    default: { access: vi.fn() },
}));

describe('pathExists', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns true when fs.access resolves (path is accessible)', async () => {
        (fs.access as Mock).mockResolvedValue(undefined);
        await expect(pathExists('/some/existing/path')).resolves.toBe(true);
        expect(fs.access).toHaveBeenCalledWith('/some/existing/path');
    });

    it('returns false when fs.access rejects (path is missing)', async () => {
        (fs.access as Mock).mockRejectedValue(new Error('ENOENT'));
        await expect(pathExists('/missing/path')).resolves.toBe(false);
    });
});
