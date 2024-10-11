/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
// eslint-disable-next-line import/no-internal-modules
import { createRoot } from 'react-dom/client';
import { type WebviewApi } from 'vscode-webview';
import { WebviewRegistry } from './api/configuration/WebviewRegistry';
import { DynamicThemeProvider } from './theme/DynamicThemeProvider';
import { type WebviewState, WithWebviewContext } from './WebviewContext';

export type ViewKey = keyof typeof WebviewRegistry;

export function render<V extends ViewKey>(
    key: V,
    vscodeApi: WebviewApi<WebviewState>,
    publicPath: string,
    rootId = 'root',
): void {
    const container = document.getElementById(rootId);
    if (!container) {
        throw new Error(`Element with id of ${rootId} not found.`);
    }

    // TODO: avoid using __webpack_public_path__
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    __webpack_public_path__ = publicPath;

    const Component: React.ComponentType = WebviewRegistry[key];

    const root = createRoot(container);

    root.render(
        <DynamicThemeProvider useAdaptive={true}>
            <WithWebviewContext vscodeApi={vscodeApi}>
                    <Component />
            </WithWebviewContext>
        </DynamicThemeProvider>,
    );
}
