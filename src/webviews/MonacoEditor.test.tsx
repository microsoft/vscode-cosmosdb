/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { VSCodeFluentProvider, useActiveVSCodeTheme } from '@microsoft/vscode-ext-webview-fluentui';
import { type EditorProps } from '@monaco-editor/react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { MonacoEditor } from './MonacoEditor';

const editorMock = vi.hoisted(() => ({
    api: { editor: { defineTheme: vi.fn(), setTheme: vi.fn() } },
    available: true,
    props: {} as EditorProps,
    layout: vi.fn(),
}));

vi.mock('monaco-editor/esm/vs/editor/editor.main', () => ({}));
vi.mock('monaco-editor/esm/vs/editor/editor.api', () => ({}));
vi.mock('@monaco-editor/react', () => ({
    loader: { config: vi.fn() },
    useMonaco: () => (editorMock.available ? editorMock.api : null),
    default: (props: EditorProps) => {
        editorMock.props = props;
        return <div data-testid="editor" />;
    },
}));

const initialStyle = document.documentElement.getAttribute('style');
const initialKind = document.body.getAttribute('data-vscode-theme-kind');

function setColor(colorId: string, color: string) {
    document.documentElement.style.setProperty(`--vscode-${colorId.replaceAll('.', '-')}`, color);
}

function ThemeProbe() {
    const { theme } = useActiveVSCodeTheme();
    return <output data-testid="brand">{theme?.colorBrandBackground}</output>;
}

describe('package webview theming', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        editorMock.available = true;
        document.body.setAttribute('data-vscode-theme-kind', 'vscode-light');
        setColor('button.background', '#0078d4');
        setColor('editor.background', '#ffffff');
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        if (initialStyle === null) document.documentElement.removeAttribute('style');
        else document.documentElement.setAttribute('style', initialStyle);
        if (initialKind === null) document.body.removeAttribute('data-vscode-theme-kind');
        else document.body.setAttribute('data-vscode-theme-kind', initialKind);
    });

    it('registers the theme before caller setup and preserves mount, layout and focus contracts', () => {
        editorMock.available = false;
        const beforeMount = vi.fn(() => expect(editorMock.api.editor.defineTheme).toHaveBeenCalled());
        const onMount = vi.fn(() => expect(editorMock.layout).toHaveBeenCalledOnce());
        const { container } = render(
            <MonacoEditor
                beforeMount={beforeMount}
                onMount={onMount}
                options={{ readOnly: true, automaticLayout: true }}
            />,
        );

        const monaco = editorMock.api as unknown as Parameters<NonNullable<EditorProps['beforeMount']>>[0];
        editorMock.props.beforeMount?.(monaco);
        expect(editorMock.api.editor.defineTheme).toHaveBeenLastCalledWith(
            'adaptive',
            expect.objectContaining({
                base: 'vs',
                colors: expect.objectContaining({ 'editor.background': '#ffffff' }),
            }),
        );
        expect(beforeMount).toHaveBeenCalledExactlyOnceWith(monaco);
        const editor = { layout: editorMock.layout } as unknown as Parameters<NonNullable<EditorProps['onMount']>>[0];
        editorMock.props.onMount?.(editor, monaco);
        expect(onMount).toHaveBeenCalledExactlyOnceWith(editor, monaco);
        expect(editorMock.props.options).toMatchObject({ readOnly: true, automaticLayout: false });
        expect(editorMock.props.theme).toBe('adaptive');
        expect(container.querySelector('section')?.firstElementChild).toHaveAttribute('data-is-focus-trap-zone-bumper');
    });

    it('uses the latest theme and callback when the loader completes after a theme change', async () => {
        editorMock.available = false;
        const oldBeforeMount = vi.fn();
        const newBeforeMount = vi.fn();
        const { rerender } = render(<MonacoEditor beforeMount={oldBeforeMount} />);
        const pendingBeforeMount = editorMock.props.beforeMount;

        await act(async () => {
            setColor('editor.background', '#123456');
            document.body.setAttribute('data-vscode-theme-kind', 'vscode-dark');
        });
        rerender(<MonacoEditor beforeMount={newBeforeMount} />);
        pendingBeforeMount?.(editorMock.api as unknown as Parameters<NonNullable<EditorProps['beforeMount']>>[0]);

        expect(editorMock.api.editor.defineTheme).toHaveBeenLastCalledWith(
            'adaptive',
            expect.objectContaining({
                base: 'vs-dark',
                colors: expect.objectContaining({ 'editor.background': '#123456' }),
            }),
        );
        expect(oldBeforeMount).not.toHaveBeenCalled();
        expect(newBeforeMount).toHaveBeenCalledOnce();
        expect(editorMock.props.beforeMount).toBe(pendingBeforeMount);
    });

    it.each([
        ['vscode-light', 'vs'],
        ['vscode-dark', 'vs-dark'],
        ['vscode-high-contrast', 'hc-black'],
        ['vscode-high-contrast-light', 'hc-light'],
    ])('updates the Monaco base for %s without replacing the editor', async (kind, base) => {
        render(<MonacoEditor />);
        const editor = screen.getByTestId('editor');
        await act(async () => document.body.setAttribute('data-vscode-theme-kind', kind));
        expect(editorMock.api.editor.defineTheme).toHaveBeenLastCalledWith(
            'adaptive',
            expect.objectContaining({ base }),
        );
        expect(editorMock.api.editor.setTheme).toHaveBeenLastCalledWith('adaptive');
        expect(screen.getByTestId('editor')).toBe(editor);
    });

    it('updates supported editor colors on root-style-only and same-kind changes', async () => {
        document.body.setAttribute('data-vscode-theme-kind', 'vscode-dark');
        render(<MonacoEditor />);
        const colors = {
            'editor.background': '#123456',
            'editorSuggestWidget.background': '#234567',
            'editorError.foreground': '#345678',
            'editor.selectionBackground': '#456789',
            'editorBracketMatch.border': '#56789a',
            'minimap.background': '#6789ab',
            'scrollbarSlider.background': '#789abc',
            focusBorder: '#89abcd',
        };
        await act(async () => {
            for (const [colorId, color] of Object.entries(colors)) setColor(colorId, color);
        });
        expect(editorMock.api.editor.defineTheme).toHaveBeenLastCalledWith(
            'adaptive',
            expect.objectContaining({ base: 'vs-dark', colors: expect.objectContaining(colors) }),
        );

        await act(async () => {
            setColor('editor.background', '#abcdef');
            document.body.setAttribute('data-vscode-theme-kind', 'vscode-dark');
        });
        expect(editorMock.api.editor.defineTheme).toHaveBeenLastCalledWith(
            'adaptive',
            expect.objectContaining({
                base: 'vs-dark',
                colors: expect.objectContaining({ 'editor.background': '#abcdef' }),
            }),
        );
    });

    it('does not reapply unchanged themes or apply updates after unmount', async () => {
        const { rerender, unmount } = render(<MonacoEditor />);
        editorMock.api.editor.defineTheme.mockClear();
        editorMock.api.editor.setTheme.mockClear();
        rerender(<MonacoEditor height="200px" />);
        await act(async () => setColor('editor.background', '#ffffff'));
        expect(editorMock.api.editor.defineTheme).not.toHaveBeenCalled();
        expect(editorMock.api.editor.setTheme).not.toHaveBeenCalled();
        unmount();
        await act(async () => setColor('editor.background', '#123456'));
        expect(editorMock.api.editor.setTheme).not.toHaveBeenCalled();
    });

    it('updates the Fluent brand for CSS-only changes and injects its stylesheet once', async () => {
        const { rerender } = render(
            <VSCodeFluentProvider>
                <ThemeProbe />
            </VSCodeFluentProvider>,
        );
        const originalBrand = screen.getByTestId('brand').textContent;
        expect(originalBrand).toMatch(/^#/);
        await act(async () => setColor('button.background', '#b03060'));
        await waitFor(() => expect(screen.getByTestId('brand').textContent).not.toBe(originalBrand));
        rerender(
            <VSCodeFluentProvider>
                <ThemeProbe />
            </VSCodeFluentProvider>,
        );
        expect(document.querySelectorAll('#vscode-ext-webview-fluentui-overrides')).toHaveLength(1);
    });
});
