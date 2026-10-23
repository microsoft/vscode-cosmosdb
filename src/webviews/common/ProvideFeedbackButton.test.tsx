/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { FluentProvider, Menu, MenuList, webLightTheme } from '@fluentui/react-components';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProvideFeedbackButton as QueryEditorFeedbackButton } from '../cosmosdb/QueryEditor/QueryPanel/ProvideFeedbackButton';
import { ProvideFeedbackButton } from './ProvideFeedbackButton';

const provideFeedback = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock('../cosmosdb/QueryEditor/state/QueryEditorContext', () => ({
    useQueryEditorDispatcher: () => ({ provideFeedback }),
}));

function Wrapper({ children }: PropsWithChildren) {
    return <FluentProvider theme={webLightTheme}>{children}</FluentProvider>;
}

beforeEach(() => {
    provideFeedback.mockReset().mockResolvedValue(undefined);
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
        return this.parentElement;
    });
});
afterEach(() => vi.restoreAllMocks());

it('preserves the Query Editor ref, quick-start target and two-step feedback action', async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLButtonElement>();
    render(<QueryEditorFeedbackButton type="button" ref={ref} />, { wrapper: Wrapper });
    const button = screen.getByRole('button', { name: 'Provide Feedback' });
    expect(ref.current).toBe(button);
    expect(button).toHaveAttribute('data-quickstart', 'provide-feedback');
    await user.click(button);
    expect(provideFeedback).not.toHaveBeenCalled();
    const item = await screen.findByRole('menuitem', { name: 'Provide Feedback' });
    expect(item).toHaveTextContent('Provide Feedback');
    expect(item).toHaveAccessibleName('Provide Feedback');
    await user.click(item);
    expect(provideFeedback).toHaveBeenCalledOnce();
});

it('preserves the direct action in the Query Editor overflow menu', async () => {
    const user = userEvent.setup();
    render(
        <Menu open>
            <MenuList>
                <QueryEditorFeedbackButton type="menuitem" />
            </MenuList>
        </Menu>,
        { wrapper: Wrapper },
    );
    await user.click(screen.getByRole('menuitem', { name: 'Provide Feedback' }));
    expect(provideFeedback).toHaveBeenCalledOnce();
});

it('uses the supplied callback without a Query Editor dispatcher or quick-start target', async () => {
    const user = userEvent.setup();
    const onProvideFeedback = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    render(<ProvideFeedbackButton type="button" onProvideFeedback={onProvideFeedback} />, { wrapper: Wrapper });
    const button = screen.getByRole('button', { name: 'Provide Feedback' });
    expect(button).not.toHaveAttribute('data-quickstart');
    button.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('menuitem', { name: 'Provide Feedback' }));
    expect(onProvideFeedback).toHaveBeenCalledOnce();
    expect(provideFeedback).not.toHaveBeenCalled();
});
