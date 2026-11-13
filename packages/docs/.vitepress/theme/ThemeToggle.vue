<script setup lang="ts">
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onBeforeUnmount, onMounted, ref } from 'vue';

const dark = ref(false);
let observer: MutationObserver | undefined;

onMounted(() => {
    const update = () => {
        dark.value = document.documentElement.getAttribute('data-theme') === 'dark';
    };
    update();
    observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
});

onBeforeUnmount(() => observer?.disconnect());

function toggleTheme() {
    dark.value = !dark.value;
    document.documentElement.setAttribute('data-theme', dark.value ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', dark.value);
}
</script>

<template>
    <button
        class="theme-toggle"
        type="button"
        :aria-pressed="dark"
        @click="toggleTheme"
    >
        Dark theme
    </button>
</template>

<style scoped>
.theme-toggle {
    margin-inline: 16px;
    padding: 4px 12px;
    border: 1px solid var(--cp-border);
    border-radius: 0.625rem;
    color: var(--cp-text);
    background: var(--cp-surface);
    font-size: 12px;
}

.theme-toggle:focus-visible {
    outline: 2px solid var(--cp-accent);
    outline-offset: 2px;
}

@media (max-width: 767px) {
    .desktop-theme-toggle {
        display: none;
    }
}
</style>
