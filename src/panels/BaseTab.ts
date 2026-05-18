/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { TelemetryContext } from '../Telemetry';

const DEV_SERVER_HOST = 'http://localhost:18080';

export class BaseTab {
    protected readonly id: string;
    protected readonly panel: vscode.WebviewPanel;
    protected readonly start: number;
    protected readonly telemetryContext: TelemetryContext;
    protected readonly viewType: string;

    protected disposables: vscode.Disposable[] = [];

    protected constructor(panel: vscode.WebviewPanel, viewType: string, telemetryProperties?: Record<string, string>) {
        this.id = crypto.randomUUID();
        this.start = Date.now();
        this.telemetryContext = new TelemetryContext(viewType);

        this.panel = panel;
        this.viewType = viewType;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.html = this.getWebviewContent();

        void this.telemetryContext.reportWebviewEvent('opened', {
            panelId: this.id,
            ...telemetryProperties,
        });
    }

    public dispose(): void {
        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }

        void this.telemetryContext.reportWebviewEvent(
            'closed',
            {
                panelId: this.id,
            },
            { openedTime: (Date.now() - this.start) / 1000 },
        );
    }

    private getWebviewContent(): string {
        const ctx = ext.context;
        const cspSource = this.panel.webview.cspSource;
        const devServer = !!process.env.DEVSERVER;
        const isProduction = ext.context.extensionMode === vscode.ExtensionMode.Production;
        const nonce = crypto.randomBytes(16).toString('base64');

        const dir = ext.isBundle ? '' : 'out/src/webviews';
        const filename = ext.isBundle ? 'views.js' : 'index.js';
        const uri = (...parts: string[]) =>
            this.panel.webview
                .asWebviewUri(vscode.Uri.file(path.join(ctx.extensionPath, dir, ...parts)))
                .toString(true);

        const srcUri = isProduction || !devServer ? uri(filename) : `${DEV_SERVER_HOST}/${filename}`;
        const reactPreambleUri = !isProduction && devServer ? `${DEV_SERVER_HOST}/@react-refresh` : null;

        // In production, Vite extracts CSS into separate files under `assets/`.
        // The dev server injects CSS via JS at runtime, so this is only needed
        // for built bundles.
        let cssLinks = '';
        if (isProduction || !devServer) {
            const assetsDir = path.join(ctx.extensionPath, dir, 'assets');
            try {
                // Sort for a stable cascade — `readdirSync` order is not
                // guaranteed across filesystems.
                const cssFiles = fs
                    .readdirSync(assetsDir)
                    .filter((f) => f.endsWith('.css'))
                    .sort((a, b) => a.localeCompare(b));
                cssLinks = cssFiles.map((f) => `<link rel="stylesheet" href="${uri('assets', f)}" />`).join('\n    ');
            } catch (error) {
                // No assets directory — older or non-Vite builds. Re-throw
                // anything other than the missing-directory case so real
                // filesystem failures aren't silently swallowed.
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw error;
                }
            }
        }

        const csp = (
            isProduction
                ? [
                      `form-action 'none';`,
                      `default-src ${cspSource};`,
                      `script-src ${cspSource} 'nonce-${nonce}';`,
                      `style-src ${cspSource} 'unsafe-inline';`,
                      `font-src ${cspSource};`,
                      `worker-src ${cspSource} blob:;`,
                      `img-src ${cspSource} data:;`,
                  ]
                : [
                      `form-action 'none';`,
                      `default-src ${cspSource} ${DEV_SERVER_HOST};`,
                      `style-src ${cspSource} ${DEV_SERVER_HOST} 'unsafe-inline';`,
                      `script-src ${cspSource} ${DEV_SERVER_HOST} 'nonce-${nonce}' 'unsafe-eval';`,
                      `connect-src ${cspSource} ${DEV_SERVER_HOST} ws:;`,
                      `font-src ${cspSource} ${DEV_SERVER_HOST};`,
                      `worker-src ${cspSource} ${DEV_SERVER_HOST} blob:;`,
                      `img-src ${cspSource} ${DEV_SERVER_HOST} data:;`,
                  ]
        ).join(' ');

        return this.template({
            title: this.panel.title,
            csp,
            srcUri,
            reactPreambleUri,
            viewType: this.viewType,
            nonce,
            cssLinks,
        });
    }

    private template(params: {
        csp: string;
        viewType: string;
        srcUri: string;
        reactPreambleUri: string | null;
        title: string;
        nonce: string;
        cssLinks: string;
    }) {
        const preamble = params.reactPreambleUri
            ? `
    <script type="module" nonce="${params.nonce}">
      import RefreshRuntime from "${params.reactPreambleUri}";
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script>`
            : '';
        return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${params.title}</title>
    <meta http-equiv="Content-Security-Policy" content="${params.csp}" />
    ${params.cssLinks}
  </head>

  <body>
    <div id="root"></div>
    <script nonce="${params.nonce}">
      globalThis.l10n_bundle = ${
          // eslint-disable-next-line no-restricted-syntax
          JSON.stringify(vscode.l10n.bundle ?? {})
      };
    </script>${preamble}
    <script type="module" nonce="${params.nonce}">
      import { render } from "${params.srcUri}";
      render("${params.viewType}", acquireVsCodeApi());
    </script>
  </body>
</html>
`;
    }
}
