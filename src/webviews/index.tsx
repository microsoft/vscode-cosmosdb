import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';
import * as React from 'react';
// eslint-disable-next-line import/no-internal-modules
import { createRoot } from 'react-dom/client';
import { CosmosDbQuery } from './CosmosDbQuery';
import { WebviewApi, WithWebviewContext } from './WebviewContext';

provideVSCodeDesignSystem().register(vsCodeButton());

export const Views = {
    cosmosDbQuery: CosmosDbQuery,
} as const;

export type ViewKey = keyof typeof Views;

export function render<V extends ViewKey>(key: V, vscodeApi: WebviewApi, publicPath: string, rootId = 'root'): void {
    const container = document.getElementById(rootId);
    if (!container) {
        throw new Error(`Element with id of ${rootId} not found.`);
    }

    // TODO: avoid using __webpack_public_path__
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    __webpack_public_path__ = publicPath;

    const Component: React.ComponentType = Views[key];

    const root = createRoot(container);

    root.render(
        <WithWebviewContext vscodeApi={vscodeApi}>
            <Component />
        </WithWebviewContext>,
    );
}
