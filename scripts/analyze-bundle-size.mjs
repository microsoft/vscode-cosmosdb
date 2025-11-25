#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Read the stats file
const statsPath = path.join(rootDir, 'bundle-analysis', 'views-stats.json');
const stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));

// Get file sizes
const viewsJsPath = path.join(rootDir, 'dist', 'views.js');
const viewsJsSize = fs.statSync(viewsJsPath).size;

console.log('\n📦 Bundle Size Analysis\n');
console.log(`views.js: ${(viewsJsSize / 1024 / 1024).toFixed(2)} MB (${viewsJsSize.toLocaleString()} bytes)\n`);

// Analyze modules by package
const packageSizes = {};

stats.modules.forEach((module) => {
    if (!module.name) return;

    // Extract package name from module path
    let packageName = 'app';

    if (module.name.includes('node_modules')) {
        const match = module.name.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
        if (match) {
            packageName = match[1];
        }
    } else if (module.name.includes('./src')) {
        packageName = 'src (app code)';
    }

    if (!packageSizes[packageName]) {
        packageSizes[packageName] = 0;
    }
    packageSizes[packageName] += module.size || 0;
});

// Sort by size
const sortedPackages = Object.entries(packageSizes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

console.log('Top 20 packages by size:\n');
sortedPackages.forEach(([pkg, size]) => {
    const sizeKB = (size / 1024).toFixed(2);
    const sizeMB = (size / 1024 / 1024).toFixed(2);
    const sizeStr = size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;
    console.log(`  ${sizeStr.padStart(12)} - ${pkg}`);
});

// Calculate totals
const totalSize = Object.values(packageSizes).reduce((a, b) => a + b, 0);
console.log(`\n  ${'Total'.padStart(12)}: ${(totalSize / 1024 / 1024).toFixed(2)} MB\n`);

// Find largest individual modules
console.log('\n📊 Top 15 Largest Individual Modules:\n');
const largestModules = stats.modules
    .filter((m) => m.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, 15);

largestModules.forEach((module) => {
    const sizeKB = (module.size / 1024).toFixed(2);
    const sizeMB = (module.size / 1024 / 1024).toFixed(2);
    const sizeStr = module.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;

    // Shorten the name for readability
    let name = module.name || 'unknown';
    if (name.length > 80) {
        name = '...' + name.substring(name.length - 77);
    }

    console.log(`  ${sizeStr.padStart(12)} - ${name}`);
});

console.log('\n');
