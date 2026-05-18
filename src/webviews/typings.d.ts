/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TypeScript doesn't natively understand SCSS imports.
 * Vite processes these files via its built-in CSS/SCSS support.
 * This declaration tells TypeScript that .scss imports are valid and return
 * an object mapping class names to their generated (potentially hashed) strings.
 */
declare module '*.scss' {
    const content: { [className: string]: string };
    export default content;
}

/**
 * Same as SCSS - TypeScript doesn't process CSS files natively.
 * Vite handles these, and this declaration allows TypeScript to accept CSS imports without errors.
 */
declare module '*.css' {
    const content: { [className: string]: string };
    export default content;
}

// Declare the l10n_bundle property injected into globalThis by VS Code webview
declare var l10n_bundle: unknown;
