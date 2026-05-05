/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Browser-safe constants for webview code.
 * Must NOT import from 'vscode', 'fs', 'path', or any Node.js built-in.
 *
 * VS Code webviews run inside Electron (Chromium), so `navigator.userAgentData`
 * is the preferred API. We fall back to the deprecated `navigator.platform` and
 * then to `navigator.userAgent` for older environments.
 */

// NavigatorUAData is part of the UA-CH spec; available in Chromium/Electron but
// not yet in every TypeScript lib version, so we declare a minimal shape here.
interface NavigatorUAData {
    platform: string;
}

export const isMac: boolean = (() => {
    if (typeof navigator === 'undefined') return false;
    const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
    const platform: string = uaData?.platform ?? navigator.platform ?? navigator.userAgent;
    return /mac/i.test(platform);
})();
