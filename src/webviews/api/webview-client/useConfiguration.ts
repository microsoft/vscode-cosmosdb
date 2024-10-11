import { useState } from 'react';
import { type WebviewApi } from 'vscode-webview';

declare global {
    interface Window {
        config?: {
            __id?: string; // deprecating
            __initialData?: string;
            __liveConnectionId?: string; // deprecating
            __mode?: string; // deprecating
            __databaseName: string; // deprecating
            __collectionName: string; // deprecating
            __documentId: string; // deprecating
            __documentContent: string; // deprecating
            __vsCodeApi: WebviewApi<unknown>; // deprecating
            [key: string]: unknown; // Optional: Allows any other properties in config
        };
    }
}

export function useConfiguration<T>(): T {
  const [configuration] = useState<T>(() => {
    const configString = decodeURIComponent(window.config?.__initialData ?? '{}');
    return JSON.parse(configString) as T;
  });

  return configuration;
}
