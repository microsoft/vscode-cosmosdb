/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TypeScript doesn't natively understand SCSS imports.
 * Webpack processes these files via sass-loader/css-loader at build time.
 * This declaration tells TypeScript that .scss imports are valid and return
 * an object mapping class names to their generated (potentially hashed) strings.
 */
declare module '*.scss' {
    const content: { [className: string]: string };
    export default content;
}

/**
 * Same as SCSS - TypeScript doesn't process CSS files.
 * Webpack handles these via css-loader, and this declaration allows
 * TypeScript to accept CSS imports without errors.
 */
declare module '*.css' {
    const content: { [className: string]: string };
    export default content;
}

/**
 * EJS (Embedded JavaScript) template files are processed by ejs-loader in webpack.
 * TypeScript doesn't understand .ejs files, so we declare them as functions
 * that accept data and return a rendered HTML string.
 */
declare module '*.ejs' {
    const template = <T>(data: T): string => '';
    export default template;
}

// Declare the l10n_bundle property injected into globalThis by VS Code webview
declare var l10n_bundle: unknown;

/**
 * Webpack injects this variable at runtime to set the base path for dynamic imports
 * and asset loading. We declare it globally so TypeScript allows assignments to it
 * (e.g., setting it before lazy-loading chunks in VS Code webviews).
 */
declare var __webpack_public_path__: string;
