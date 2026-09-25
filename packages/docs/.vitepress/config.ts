/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from 'vitepress';
import packageJson from '../package.json' with { type: 'json' };

export default defineConfig({
    title: 'Cosmos DB developer tools',
    description:
        'Schema inference and SQL language tooling for Monaco, CodeMirror, and VS Code.',
    lang: 'en-US',
    base: process.env.DOCS_BASE ?? '/',
    appearance: false,
    head: [
        [
            'script',
            {},
            `(() => {
                const param = new URLSearchParams(window.location.search).get("scoutTheme");
                const theme =
                    param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
                document.documentElement.setAttribute("data-theme", theme);
                document.documentElement.classList.toggle("dark", theme === "dark");
            })();`,
        ],
    ],
    themeConfig: {
        siteTitle: 'Cosmos DB tools',
        nav: [
            { text: 'Playground', link: '/playground' },
            {
                text: 'npm',
                items: [
                    {
                        text: 'Language service',
                        link: 'https://www.npmjs.com/package/@azure/cosmosdb-nosql-language-service',
                    },
                    {
                        text: 'Schema analyzer',
                        link: 'https://www.npmjs.com/package/@azure/cosmosdb-schema-analyzer',
                    },
                ],
            },
        ],
        sidebar: [
            { text: 'Overview', link: '/' },
            { text: 'Getting started', link: '/getting-started' },
            { text: 'Language Service API', link: '/language-service' },
            { text: 'Schema Analyzer API', link: '/schema-analyzer' },
            { text: 'Monaco', link: '/monaco' },
            { text: 'CodeMirror', link: '/codemirror' },
            { text: 'VS Code', link: '/vscode' },
            { text: 'Samples', link: '/samples' },
            { text: 'Playground', link: '/playground' },
            { text: 'Limitations', link: '/limitations' },
        ],
        socialLinks: [
            {
                icon: 'github',
                link: 'https://github.com/microsoft/vscode-cosmosdb',
            },
        ],
        search: { provider: 'local' },
        footer: {
            message: `Language service ${packageJson.dependencies['@azure/cosmosdb-nosql-language-service']} | Schema analyzer ${packageJson.dependencies['@azure/cosmosdb-schema-analyzer']}. Released under the MIT License.`,
            copyright: 'Copyright Microsoft Corporation.',
        },
    },
});
