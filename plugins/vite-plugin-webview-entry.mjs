/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Dev-server plugin: serves `/views.js` as a re-export of the real entry so the
 * VS Code webview can load it from `http://localhost:18080/views.js` with full
 * HMR support.
 *
 * The webview lives at a different origin (`vscode-webview://...`) than the
 * dev server (`http://localhost:18080`), so we must set CORS headers
 * ourselves — relying on Vite's global `cors: true` is unreliable because
 * `server.middlewares.use()` ordering is not guaranteed to run after Vite's
 * built-in cors middleware.
 *
 * In production (`vite build`) this plugin is a no-op — the real `views.js`
 * entry file is emitted by Rolldown directly.
 *
 * @returns {import('vite').Plugin}
 */
export function webviewEntry() {
    return {
        name: 'vscode-webview-entry',
        configureServer(server) {
            server.middlewares.use('/views.js', (_req, res) => {
                res.setHeader('Content-Type', 'application/javascript');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Cache-Control', 'no-store');
                // Re-export the real entry so the webview can `import { render }`.
                // `export * from` re-exports named bindings (including `render`).
                res.end(`export * from "/src/webviews/index.tsx";`);
            });
        },
    };
}
