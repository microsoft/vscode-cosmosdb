/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import ThemeToggle from './ThemeToggle.vue';
import './style.css';

export default {
    extends: DefaultTheme,
    Layout: () =>
        h(DefaultTheme.Layout, null, {
            'nav-bar-content-after': () =>
                h(ThemeToggle, { class: 'desktop-theme-toggle' }),
            'nav-screen-content-after': () => h(ThemeToggle),
        }),
};
