#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Reads and parses the package.json file
 * @returns {object} Parsed package.json content
 */
function readPackageJson() {
    const packageJsonPath = path.join(__dirname, '..', 'package.json');

    try {
        const content = fs.readFileSync(packageJsonPath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error(`Failed to read package.json: ${error.message}`);
        process.exit(1);
    }
}

/**
 * Executes a shell command with proper error handling
 * @param {string} command - The command to execute
 * @param {string} description - Human-readable description of the command
 */
function executeCommand(command, description) {
    console.log(`\n▶ ${description}...`);
    console.log(`  Command: ${command}`);

    try {
        execSync(command, { stdio: 'inherit', shell: true });
        console.log(`✓ ${description} completed successfully`);
    } catch (error) {
        console.error(`✗ ${description} failed`);
        if (error.status) {
            console.error(`  Exit code: ${error.status}`);
        }
        if (error.message) {
            console.error(`  Error: ${error.message}`);
        }
        process.exit(error.status || 1);
    }
}

/**
 * Main execution function
 */
function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  VSIX Packaging Script');
    console.log('═══════════════════════════════════════════════════');

    const packageJson = readPackageJson();
    const { name, version, preview } = packageJson;

    // Validate preview field if present, default to false if missing
    if (preview !== undefined && typeof preview !== 'boolean') {
        console.error(
            `\n❌ Error: The "preview" field in package.json must be a boolean (true or false). ` +
                `Found: ${typeof preview} (${JSON.stringify(preview)})`,
        );
        process.exit(1);
    }

    // Determine if this is a preview build (default to false if missing)
    const isPreview = preview === true;
    const preReleaseFlag = isPreview ? '--pre-release' : '';

    console.log(`\nPackage: ${name}`);
    console.log(`Version: ${version}`);
    console.log(`Preview: ${isPreview ? 'Yes' : 'No'}`);

    // Step 1: Build the extension
    executeCommand('npm run webpack-prod', 'Building extension');

    // Step 2: Prepare dist directory and package VSIX
    const outputFileName = `${name}-${version}.vsix`;
    const vsceCommand = [
        'cd dist',
        'npm pkg delete "scripts.vscode:prepublish"',
        `npx vsce package ${preReleaseFlag} --no-dependencies --out ../${outputFileName}`,
    ].join(' && ');

    executeCommand(vsceCommand, 'Packaging VSIX');

    console.log('\n═══════════════════════════════════════════════════');
    console.log(`✓ VSIX package created: ${outputFileName}`);
    console.log('═══════════════════════════════════════════════════\n');
}

// Run the script
main();
