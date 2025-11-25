#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', 'src', 'webviews');

// Icon name to kebab-case conversion
function iconNameToKebab(iconName) {
    // Remove common suffixes
    const baseName = iconName.replace(/(Regular|Filled|Light|16|20|24|28|32|48)$/i, '');

    // Convert PascalCase to kebab-case
    return baseName
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, '');
}

// Process a single file
function processFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    let modified = false;
    let newContent = content;

    // Find all FluentUI icon imports
    const importRegex = /import\s+{([^}]+)}\s+from\s+['"]@fluentui\/react-icons['"]/g;
    const matches = [...content.matchAll(importRegex)];

    if (matches.length === 0) {
        return false;
    }

    // Process each import statement
    for (const match of matches) {
        const fullImport = match[0];
        const iconsString = match[1];

        // Parse individual icons
        const icons = iconsString
            .split(',')
            .map((icon) => icon.trim())
            .filter((icon) => icon.length > 0);

        // Generate individual import statements
        const newImports = icons
            .map((icon) => {
                const kebabName = iconNameToKebab(icon);
                return `import ${icon} from '@fluentui/react-icons/lib/fonts/${kebabName}';`;
            })
            .join('\n');

        // Replace the old import with new imports
        newContent = newContent.replace(fullImport, newImports);
        modified = true;
    }

    if (modified) {
        fs.writeFileSync(filePath, newContent, 'utf-8');
        return true;
    }

    return false;
}

// Find all TypeScript/TSX files
function findTsxFiles(dir, results = []) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            findTsxFiles(fullPath, results);
        } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
            results.push(fullPath);
        }
    }

    return results;
}

// Main execution
console.log('\n🔧 Fixing FluentUI icon imports...\n');

const allFiles = findTsxFiles(srcDir);
let modifiedCount = 0;

for (const file of allFiles) {
    if (processFile(file)) {
        const relativePath = file.replace(srcDir, 'src/webviews');
        console.log(`✅ Fixed: ${relativePath}`);
        modifiedCount++;
    }
}

console.log(`\n✨ Done! Modified ${modifiedCount} file(s)\n`);

if (modifiedCount > 0) {
    console.log('Next steps:');
    console.log('1. Review the changes (git diff)');
    console.log('2. Rebuild: npm run webpack-prod-wv');
    console.log('3. Verify bundle size reduction\n');
}
