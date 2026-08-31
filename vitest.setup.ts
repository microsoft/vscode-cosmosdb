/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Global Vitest setup shared by every test file.
//
// `@testing-library/jest-dom/vitest` registers the custom DOM matchers (e.g. `toBeInTheDocument`,
// `toHaveAttribute`) and augments Vitest's `expect` types. It is a no-op for the node-environment
// tests that never touch the DOM, so it is safe to load globally. React Testing Library auto-runs
// its `cleanup` in `afterEach` when imported under Vitest's globals, so the component test files do
// not need to wire that up and node tests never have to import react-dom here.
import '@testing-library/jest-dom/vitest';

// jsdom does not implement ResizeObserver or matchMedia, both of which Fluent UI components and the
// query-generation input rely on. Provide minimal stubs so component tests can render under jsdom.
if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    };
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string): MediaQueryList =>
        ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
        }) as unknown as MediaQueryList;
}

// jsdom does not implement the canvas 2D context. Code paths that use it for text measurement are
// expected to gracefully handle a null context, so return null instead of letting jsdom throw.
if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
}
