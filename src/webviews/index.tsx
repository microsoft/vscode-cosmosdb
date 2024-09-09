import * as React from 'react';
// eslint-disable-next-line import/no-internal-modules
import { createRoot } from 'react-dom/client';
import { type WebviewApi } from 'vscode-webview';
import { QueryEditor } from './QueryEditor/QueryEditor';
import { DynamicThemeProvider } from './theme/DynamicThemeProvider';
import { CollectionView } from './vCore/collectionView/CollectionView';
import { WithWebviewContext, type WebviewState } from './WebviewContext';

export const Views = {
    cosmosDbQuery: QueryEditor,
    vCoreCollectionView: CollectionView,
} as const;

export type ViewKey = keyof typeof Views;

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

    const Component: React.ComponentType = Views[key];

    const root = createRoot(container);

    root.render(
        <DynamicThemeProvider>
            <WithWebviewContext vscodeApi={vscodeApi}>
                <Component />
            </WithWebviewContext>
        </DynamicThemeProvider>,
    );
}
