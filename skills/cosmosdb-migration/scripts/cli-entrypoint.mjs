import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMainModule(moduleUrl) {
    if (!process.argv[1]) return false;
    try {
        return fs.realpathSync(process.argv[1]) === fileURLToPath(moduleUrl);
    } catch (error) {
        // Extension hosts can supply a launcher path that does not exist on disk.
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
        throw error;
    }
}
