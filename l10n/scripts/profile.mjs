import { getL10nJson } from '@vscode/l10n-dev';
import * as glob from 'glob';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const GLOB_DEFAULTS = { nodir: true, absolute: true, windowsPathsNoEscape: true };
const nodeModulesPath = path.join(process.cwd(), 'node_modules');

const exportSourcePaths = [
    './src',
    path.join(nodeModulesPath, '@microsoft', 'vscode-azext-utils', 'dist', 'esm', 'src'),
    path.join(nodeModulesPath, '@microsoft', 'vscode-azext-azureutils', 'dist', 'esm', 'src'),
    path.join(nodeModulesPath, '@microsoft', 'vscode-azext-azureauth', 'dist', 'esm', 'src'),
    path.join(nodeModulesPath, '@microsoft', 'vscode-azureresources-api', 'dist', 'esm', 'src'),
];

// Step 1: glob all at once
let t = performance.now();
const matches = glob.sync(
    exportSourcePaths.map((p) => (/\.(ts|tsx|js|jsx)$/.test(p) ? p : path.posix.join(p, '{,**}', '*.{ts,tsx,js,jsx}'))),
    GLOB_DEFAULTS,
);
console.log(`\nglob (total): ${(performance.now() - t).toFixed(0)}ms — ${matches.length} files`);

// Per-path breakdown
for (const p of exportSourcePaths) {
    const t2 = performance.now();
    const m = glob.sync(path.posix.join(p, '{,**}', '*.{ts,tsx,js,jsx}'), GLOB_DEFAULTS);
    const label = p.includes('node_modules') ? p.split(/node_modules[\\/]/)[1] : p;
    console.log(`  [${label}]: ${(performance.now() - t2).toFixed(0)}ms — ${m.length} files`);
}

// Step 2: readFileSync
t = performance.now();
const tsFileContents = matches.map((m) => ({
    extension: path.extname(m),
    contents: readFileSync(path.resolve(m), 'utf8'),
}));
const totalSize = tsFileContents.reduce((s, f) => s + f.contents.length, 0);
console.log(`\nreadFile: ${(performance.now() - t).toFixed(0)}ms — ${(totalSize / 1024).toFixed(0)} KB total`);

// Step 3: getL10nJson (the AST parser)
t = performance.now();
const result = await getL10nJson(tsFileContents);
console.log(`\ngetL10nJson (AST parse): ${(performance.now() - t).toFixed(0)}ms — ${Object.keys(result).length} strings found`);

