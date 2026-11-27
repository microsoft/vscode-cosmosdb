/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AriaLiveAnnouncer, useFocusFinders } from '@fluentui/react-components';
import { VSCodeFluentProvider } from '@microsoft/vscode-ext-webview-fluentui';
import { type WebviewState, WithWebviewContext } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { type l10nJsonFormat } from '@vscode/l10n';
import { isPlainObject } from 'es-toolkit';
import type * as React from 'react';
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { type WebviewApi } from 'vscode-webview';
import './index.scss';
import { WebviewRegistry } from './WebviewRegistry';

export type ViewKey = keyof typeof WebviewRegistry;

// Wrapper to manage focus after mounting
function FocusManager({ focusOnMount, children }: { focusOnMount: boolean; children: React.ReactNode }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { findFirstFocusable } = useFocusFinders();

    useEffect(() => {
        if (focusOnMount && containerRef.current) {
            findFirstFocusable(containerRef.current)?.focus();
        }
    }, [focusOnMount, findFirstFocusable]);

    return <div ref={containerRef}>{children}</div>;
}

export function render<V extends ViewKey>(key: V, vscodeApi: WebviewApi<WebviewState>, rootId = 'root'): void {
    const l10nBundle: l10nJsonFormat = isPlainObject(l10n_bundle) ? (l10n_bundle as l10nJsonFormat) : {};
    l10n.config({ contents: l10nBundle });

    const container = document.getElementById(rootId);
    if (!container) {
        throw new Error(l10n.t('Element with id of {rootId} not found.', { rootId }));
    }

    const root = createRoot(container);
    // Let users Tab into the diagnostics scroll region instead of outlining the entire view on open.
    const focusOnMount = key !== 'cosmosDbConnectionDiagnostics';

    // Kick off the dynamic import for the requested view only. Other views
    // (and their transitive deps like Monaco) are not fetched.
    void WebviewRegistry[key]().then((Component) => {
        root.render(
            <AriaLiveAnnouncer>
                <VSCodeFluentProvider>
                    <WithWebviewContext vscodeApi={vscodeApi}>
                        <FocusManager focusOnMount={focusOnMount}>
                            <Component />
                        </FocusManager>
                    </WithWebviewContext>
                </VSCodeFluentProvider>
            </AriaLiveAnnouncer>,
        );
    });
}
