/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from 'react';

declare global {
    interface Window {
        config?: {
            __initialData?: string;
            [key: string]: unknown; // Optional: Allows any other properties in config
        };
    }
}

/**
 * Use this hook to access the configuration object that was passed to the webview at its creation.W
 *
 * @returns The configuration object that was passed to the webview at its creation
 */
export function useConfiguration<T>(): T {
    const [configuration] = useState<T>(() => {
        const configString = decodeURIComponent(window.config?.__initialData ?? '{}');
        return JSON.parse(configString) as T;
    });

    return configuration;
}
