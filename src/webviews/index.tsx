import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';
import * as React from 'react';
// eslint-disable-next-line import/no-internal-modules
import { FluentProvider } from '@fluentui/react-components';
import { createRoot } from 'react-dom/client';
import { type WebviewApi } from 'vscode-webview';
import { CosmosDbQuery } from './CosmosDbQuery';
import { FluentUiDemo } from './FluentUIDemo/FluentUiDemo';
import { adaptiveTheme } from './themeGenerator';
import { CollectionView } from './vCore/collectionView';
import { WithWebviewContext } from './WebviewContext';

provideVSCodeDesignSystem().register(vsCodeButton());

export const Views = {
    cosmosDbQuery: CosmosDbQuery,
    fluentUiDemo: FluentUiDemo,
    vCoreCollectionView: CollectionView
} as const;

export type ViewKey = keyof typeof Views;

export function render<V extends ViewKey>(
    key: V,
    vscodeApi: WebviewApi<unknown>,
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
        <FluentProvider theme={adaptiveTheme}>
            <WithWebviewContext vscodeApi={vscodeApi}>
                <Component />
            </WithWebviewContext>
        </FluentProvider>
    );
}
