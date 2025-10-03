/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AriaLiveAnnouncer, useFocusFinders } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { type l10nJsonFormat } from '@vscode/l10n';
import type * as React from 'react';
import { useEffect, useRef } from 'react';
// eslint-disable-next-line import/no-internal-modules
import { createRoot } from 'react-dom/client';
import { type WebviewApi } from 'vscode-webview';
import { WebviewRegistry } from './api/configuration/WebviewRegistry';
import { DynamicThemeProvider } from './theme/DynamicThemeProvider';
import { type WebviewState, WithWebviewContext } from './WebviewContext';

export type ViewKey = keyof typeof WebviewRegistry;

// Wrapper to manage focus after mounting
function FocusManager({ children }: { children: React.ReactNode }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { findFirstFocusable } = useFocusFinders();

    useEffect(() => {
        // Find first focusable element and focus it
        if (containerRef.current) {
            findFirstFocusable(containerRef.current)?.focus();
        }
    }, [findFirstFocusable]);

    return <div ref={containerRef}>{children}</div>;
}

export function render<V extends ViewKey>(key: V, vscodeApi: WebviewApi<WebviewState>, rootId = 'root'): void {
    l10n.config({
        contents: (globalThis.l10n_bundle as l10nJsonFormat) ?? {},
    });
    const container = document.getElementById(rootId);
    if (!container) {
        throw new Error(l10n.t('Element with id of {rootId} not found.', { rootId }));
    }

    const Component: React.ComponentType = WebviewRegistry[key];

    const root = createRoot(container);

    root.render(
        <AriaLiveAnnouncer>
            <DynamicThemeProvider useAdaptive={true}>
                <WithWebviewContext vscodeApi={vscodeApi}>
                    <FocusManager>
                        <Component />
                    </FocusManager>
                </WithWebviewContext>
            </DynamicThemeProvider>
        </AriaLiveAnnouncer>,
    );
}
