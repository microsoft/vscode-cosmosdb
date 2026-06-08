#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const MAX_CONCURRENT_FETCHES = 5;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Error subclass used to signal that a request was throttled by GitHub.
 * The caller can decide whether to treat this as a soft failure (warning)
 * instead of failing the build.
 */
class RateLimitError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RateLimitError';
    }
}

/**
 * Detects whether a fetch Response indicates a GitHub rate-limit/abuse limit.
 * GitHub returns 429 for secondary rate limits and 403 with
 * `x-ratelimit-remaining: 0` for the primary REST API rate limit.
 * @param {Response} response
 * @returns {boolean}
 */
function isRateLimited(response) {
    if (response.status === 429) {
        return true;
    }

    if (response.status === 403) {
        const remaining = response.headers.get('x-ratelimit-remaining');
        if (remaining !== null && Number(remaining) === 0) {
            return true;
        }

        if (response.headers.get('retry-after') !== null) {
            return true;
        }
    }

    return false;
}

/**
 * Computes the delay to wait before retrying a throttled request.
 * @param {Response} response
 * @param {number} attempt - Zero-based attempt index
 * @returns {number} Delay in milliseconds
 */
function computeRetryDelay(response, attempt) {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!Number.isNaN(seconds)) {
            return seconds * 1000;
        }
    }
    return INITIAL_RETRY_DELAY_MS * 2 ** attempt;
}

/**
 * Reads and parses the package.json file
 * @returns {object} Parsed package.json content
 */
function readPackageJson() {
    const packageJsonPath = path.join(rootDir, 'package.json');

    try {
        const content = fs.readFileSync(packageJsonPath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error(`Failed to read package.json: ${error.message}`);
        process.exit(1);
    }
}

/**
 * Lists all files in a GitHub directory tree at a specific commit
 * @param {string} repo - GitHub repo in "owner/repo" format
 * @param {string} commit - Full commit hash
 * @param {string} dirPath - Directory path within the repo
 * @returns {Promise<string[]>} Array of file paths relative to the repo root
 */
async function listGitHubTree(repo, commit, dirPath, exclude = []) {
    const url = `https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const response = await fetch(url, {
            headers: { Accept: 'application/vnd.github.v3+json' },
        });

        if (response.ok) {
            const data = await response.json();
            const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;

            return data.tree
                .filter((entry) => entry.type === 'blob' && entry.path.startsWith(prefix))
                .map((entry) => entry.path)
                .filter((p) => !exclude.some((pattern) => p.endsWith(`/${pattern}`)));
        }

        if (isRateLimited(response)) {
            if (attempt < MAX_RETRIES) {
                const delay = computeRetryDelay(response, attempt);
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            }
            throw new RateLimitError(
                `HTTP ${response.status} ${response.statusText} — rate-limited while listing tree at ${url}`,
            );
        }

        throw new Error(`HTTP ${response.status} ${response.statusText} — failed to list tree at ${url}`);
    }
}

/**
 * Downloads a file from a raw GitHub URL for a specific commit
 * @param {string} repo - GitHub repo in "owner/repo" format
 * @param {string} commit - Full commit hash
 * @param {string} filePath - Path to the file within the repo
 * @returns {Promise<string>} File contents
 */
async function fetchFileFromGitHub(repo, commit, filePath) {
    const url = `https://raw.githubusercontent.com/${repo}/${commit}/${filePath}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const response = await fetch(url);

        if (response.ok) {
            return await response.text();
        }

        if (isRateLimited(response)) {
            if (attempt < MAX_RETRIES) {
                const delay = computeRetryDelay(response, attempt);
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            }
            throw new RateLimitError(
                `HTTP ${response.status} ${response.statusText} — rate-limited while fetching ${url}`,
            );
        }

        throw new Error(`HTTP ${response.status} ${response.statusText} — failed to fetch ${url}`);
    }
}

/**
 * Executes async tasks with a concurrency limit
 * @param {Array<() => Promise<T>>} tasks - Array of async task functions
 * @param {number} limit - Maximum concurrent tasks
 * @returns {Promise<T[]>} Results
 * @template T
 */
async function withConcurrency(tasks, limit) {
    const results = [];
    let index = 0;

    async function worker() {
        while (index < tasks.length) {
            const i = index++;
            results[i] = await tasks[i]();
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
    return results;
}

/**
 * Removes a directory and all its contents
 * @param {string} dirPath - Absolute path to the directory
 */
function cleanDirectory(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true });
    }
}

/**
 * Emits a GitHub Actions warning annotation when running in CI, or a plain
 * warning otherwise.
 * @param {string} message
 */
function emitWarning(message) {
    if (process.env.GITHUB_ACTIONS === 'true') {
        console.log(`::warning::${message}`);
    } else {
        console.warn(`⚠ ${message}`);
    }
}

/**
 * Main execution function
 */
async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  Fetch External Skills');
    console.log('═══════════════════════════════════════════════════');

    const packageJson = readPackageJson();
    const { externalSkills } = packageJson;

    if (!externalSkills || Object.keys(externalSkills).length === 0) {
        console.log('\nNo external skills configured in package.json.');
        return;
    }

    let hasErrors = false;
    let rateLimited = false;

    for (const [skillName, config] of Object.entries(externalSkills)) {
        const { repo, path: skillPath, commit, exclude } = config;

        console.log(`\n▶ Fetching skill: ${skillName}`);
        console.log(`  Repository: ${repo}`);
        console.log(`  Commit: ${commit}`);
        console.log(`  Path: ${skillPath}`);

        try {
            // List all files in the skill directory
            console.log(`  Listing files...`);
            const files = await listGitHubTree(repo, commit, skillPath, exclude);
            console.log(`  Found ${files.length} files`);

            // Fetch all files into memory first, so that a partial failure
            // (e.g. rate-limit halfway through) does not leave the local
            // skills/ directory in a corrupted state.
            const destDir = path.join(rootDir, skillPath);
            const downloaded = new Array(files.length);
            let fetched = 0;
            const tasks = files.map((filePath, i) => async () => {
                const content = await fetchFileFromGitHub(repo, commit, filePath);
                downloaded[i] = { filePath, content };
                fetched++;
                process.stdout.write(`\r  Fetching files... ${fetched}/${files.length}`);
            });

            await withConcurrency(tasks, MAX_CONCURRENT_FETCHES);

            // All files fetched successfully — now replace the local copy.
            cleanDirectory(destDir);
            for (const { filePath, content } of downloaded) {
                const destPath = path.join(rootDir, filePath);
                const dir = path.dirname(destPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(destPath, content);
            }

            console.log(`\n✓ ${skillName} updated successfully (${files.length} files)`);
        } catch (error) {
            if (error instanceof RateLimitError) {
                console.error(`\n⚠ Skipping ${skillName} due to GitHub rate limit: ${error.message}`);
                rateLimited = true;
            } else {
                console.error(`\n✗ Failed to fetch ${skillName}: ${error.message}`);
                hasErrors = true;
            }
        }
    }

    console.log('\n═══════════════════════════════════════════════════');

    if (hasErrors) {
        console.error('✗ Some skills failed to fetch. See errors above.');
        process.exit(1);
    }

    if (rateLimited) {
        emitWarning(
            'One or more external skills could not be fetched because GitHub rate-limited the request. ' +
                'The locally committed skills/ directory was left untouched. ' +
                'Re-run this job later (optionally authenticated) to refresh the skills.',
        );
        console.log('═══════════════════════════════════════════════════\n');
        return;
    }

    console.log('✓ All skills fetched successfully.');
    console.log('═══════════════════════════════════════════════════\n');
}

main();
