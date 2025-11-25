#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Script to check if tree shaking is working correctly
 * Analyzes the webpack stats and bundle to detect unused imports
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATS_FILE = path.join(__dirname, '../bundle-analysis/views-stats.json');
const BUNDLE_FILE = path.join(__dirname, '../dist/views.js');

console.log('🔍 Checking Tree Shaking Effectiveness...\n');

// Check 1: Analyze bundle size
if (fs.existsSync(BUNDLE_FILE)) {
    const stats = fs.statSync(BUNDLE_FILE);
    const sizeInKB = (stats.size / 1024).toFixed(2);
    const sizeInMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`📦 Bundle Size: ${sizeInKB} KB (${sizeInMB} MB)`);
    console.log(`   File: ${BUNDLE_FILE}\n`);
}

// Check 2: Search for FluentUI icons in the bundle
console.log('🔎 Searching for @fluentui/react-icons in bundle...\n');

if (fs.existsSync(BUNDLE_FILE)) {
    const bundleContent = fs.readFileSync(BUNDLE_FILE, 'utf-8');

    // Look for signs of tree shaking issues
    const checks = [
        {
            name: 'FluentUI Icon Factory Pattern',
            pattern: /createFluentIcon|makeStyles|__webpack_exports__\s*=\s*{[^}]*Icon[^}]*}/g,
            description: 'Icon creation utilities (should be minimal if tree shaking works)',
        },
        {
            name: 'Unused Icon Names',
            pattern:
                /"(?:Add|Arrow|Edit|Delete|Document|Eye|Stop|Database|Tab|Library|Folder|Comment|Emoji|More|Checkmark|Number)(?:Filled|Regular)"/g,
            description: 'Icon name strings in bundle',
        },
        {
            name: 'FluentUI Bundle Identifier',
            pattern: /@fluentui\/react-icons/g,
            description: 'Package identifier references',
        },
    ];

    checks.forEach((check) => {
        const matches = bundleContent.match(check.pattern);
        const count = matches ? matches.length : 0;
        console.log(`✓ ${check.name}: ${count} occurrences`);
        console.log(`  ${check.description}`);
        if (matches && matches.length < 10) {
            console.log(`  Sample matches:`, matches.slice(0, 5));
        }
        console.log();
    });

    // Check for specific icons we use
    const iconsUsed = [
        'EditRegular',
        'DeleteRegular',
        'AddFilled',
        'ArrowLeftFilled',
        'ArrowRightFilled',
        'EyeRegular',
        'StopRegular',
    ];

    console.log('📋 Checking specific icons used in code:\n');
    iconsUsed.forEach((iconName) => {
        const kebabName = iconName
            .replace(/([A-Z])/g, '-$1')
            .toLowerCase()
            .replace(/^-/, '')
            .replace(/-filled$/, '')
            .replace(/-regular$/, '');

        // Look for the icon component or its path
        const iconPathPattern = new RegExp(`lib/atoms/svg/${kebabName}`, 'g');
        const iconMatches = bundleContent.match(iconPathPattern);

        console.log(`  ${iconName} (${kebabName}): ${iconMatches ? '✓ FOUND' : '✗ NOT FOUND'}`);
    });
}

// Check 3: Analyze webpack stats
console.log('\n📊 Analyzing Webpack Stats...\n');

if (fs.existsSync(STATS_FILE)) {
    const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));

    // Find modules related to @fluentui/react-icons
    const fluentIconModules =
        stats.modules?.filter(
            (m) => m.name?.includes('@fluentui/react-icons') || m.identifier?.includes('@fluentui/react-icons'),
        ) || [];

    console.log(`Total @fluentui/react-icons modules: ${fluentIconModules.length}`);

    if (fluentIconModules.length > 0) {
        console.log('\nTop 10 FluentUI modules by size:\n');
        fluentIconModules
            .sort((a, b) => (b.size || 0) - (a.size || 0))
            .slice(0, 10)
            .forEach((m) => {
                const sizeKB = ((m.size || 0) / 1024).toFixed(2);
                const name = m.name || m.identifier || 'unknown';
                const shortName = name.length > 80 ? '...' + name.slice(-77) : name;
                console.log(`  ${sizeKB.padStart(8)} KB - ${shortName}`);
            });

        // Calculate total size
        const totalSize = fluentIconModules.reduce((sum, m) => sum + (m.size || 0), 0);
        const totalSizeKB = (totalSize / 1024).toFixed(2);
        console.log(`\n  Total FluentUI size: ${totalSizeKB} KB`);
    }

    // Check for chunk information
    if (stats.chunks) {
        console.log('\n📦 Chunk Analysis:\n');
        stats.chunks.forEach((chunk) => {
            const sizeKB = ((chunk.size || 0) / 1024).toFixed(2);
            console.log(`  ${chunk.names?.[0] || chunk.id}: ${sizeKB} KB`);
        });
    }
}

console.log('\n✅ Analysis Complete!\n');
console.log('💡 Tips for verifying tree shaking:');
console.log('   1. Total @fluentui modules should be ~20 (one per icon used)');
console.log('   2. Each icon module should be ~1-2 KB');
console.log('   3. Bundle should NOT contain unused icon names');
console.log('   4. Open bundle-analysis/views-report.html for visual analysis');
console.log('\n   To open the report:');
console.log('   > start bundle-analysis/views-report.html\n');
