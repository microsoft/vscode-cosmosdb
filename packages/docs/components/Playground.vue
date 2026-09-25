<script setup lang="ts">
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { type Diagnostic } from '@azure/cosmosdb-nosql-language-service';
import scenarios from '../samples/scenarios.json';
import { type PlaygroundEditor } from '../src/editor';
import { type PlaygroundSession } from '../src/session';

const id = useId();
const initial = scenarios[0];
const selectedSample = ref(initial.id);
const selectedEditor = ref<'monaco' | 'codemirror'>('monaco');
const sample = computed(() => scenarios.find((item) => item.id === selectedSample.value) ?? initial);
const query = ref(initial.query);
const documents = ref(JSON.stringify(initial.documents, undefined, 2));
const appliedDocuments = ref<string>();
const schemaJson = ref('');
const schemaError = ref('');
const editorError = ref('');
const status = ref('Loading the language service…');
const diagnostics = ref<Diagnostic[]>([]);
const container = ref<HTMLElement>();
const ready = ref(false);
const serviceReady = ref(false);
const loading = ref(true);
const schemaPending = computed(() => appliedDocuments.value !== documents.value);
const schemaMessage = computed(() => {
    if (schemaError.value) return 'No schema is active. Fix the documents and apply again.';
    if (!schemaJson.value) return 'No schema is active. Apply JSON documents to enable field suggestions.';
    if (schemaPending.value) return 'Documents changed. The editor still uses the last applied schema until you apply again.';
    return 'The editor uses the inferred schema shown below.';
});

let session: PlaygroundSession | undefined;
let editor: PlaygroundEditor | undefined;
let themeObserver: MutationObserver | undefined;
let generation = 0;
let mounted = false;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isDark(): boolean {
    return document.documentElement.dataset.theme === 'dark';
}

function updateDiagnostics(): void {
    if (!session) return;
    try {
        diagnostics.value = session.service.getDiagnostics(query.value);
    } catch (error) {
        diagnostics.value = [];
        editorError.value = `Diagnostics failed: ${errorMessage(error)}`;
    }
}

function applySchema(): void {
    if (!session) return;
    schemaError.value = '';
    schemaJson.value = '';
    appliedDocuments.value = undefined;
    try {
        const schema = session.applyDocuments(documents.value);
        schemaJson.value = JSON.stringify(schema, undefined, 2);
        appliedDocuments.value = documents.value;
        status.value = 'Schema applied. Field completions and diagnostics have been refreshed.';
    } catch (error) {
        schemaError.value = `Cannot apply schema: ${errorMessage(error)}`;
        status.value = 'Schema removed. SQL syntax features remain available without document fields.';
    }

    try {
        editor?.refreshSchema();
        updateDiagnostics();
    } catch (error) {
        editorError.value = `Editor refresh failed: ${errorMessage(error)}`;
    }
}

async function mountEditor(): Promise<void> {
    if (!mounted || !container.value || !session) return;
    const currentGeneration = ++generation;
    ready.value = false;
    loading.value = true;
    editorError.value = '';
    editor?.dispose();
    editor = undefined;
    status.value = `Loading ${selectedEditor.value === 'monaco' ? 'Monaco' : 'CodeMirror'}…`;

    try {
        const createEditor =
            selectedEditor.value === 'monaco'
                ? (await import('../samples/monaco')).createMonacoEditor
                : (await import('../samples/codemirror')).createCodeMirrorEditor;
        if (!mounted || currentGeneration !== generation || !container.value) return;

        editor = createEditor({
            container: container.value,
            service: session.service,
            query: query.value,
            dark: isDark(),
            onChange(value) {
                query.value = value;
                updateDiagnostics();
            },
        });
        editor.refreshSchema();
        updateDiagnostics();
        ready.value = true;
        status.value = `${selectedEditor.value === 'monaco' ? 'Monaco' : 'CodeMirror'} ready. Your query and documents are preserved.`;
    } catch (error) {
        if (!mounted || currentGeneration !== generation) return;
        editor?.dispose();
        editor = undefined;
        editorError.value = `Cannot load editor: ${errorMessage(error)}`;
        status.value = 'Your query and documents are preserved. Retry loading the editor or choose the other editor.';
    } finally {
        if (mounted && currentGeneration === generation) loading.value = false;
    }
}

function formatQuery(): void {
    if (!editor || !session) return;
    try {
        editorError.value = '';
        const before = query.value;
        editor.format();
        updateDiagnostics();
        status.value =
            before !== query.value
                ? 'Query formatted. Undo in the editor to restore the previous text.'
                : 'No formatting changes. Invalid SQL is not repaired automatically.';
        editor.focus();
    } catch (error) {
        editorError.value = `Formatting failed: ${errorMessage(error)}`;
    }
}

function loadSampleQuery(): void {
    query.value = sample.value.query;
    try {
        editor?.setQuery(query.value);
        updateDiagnostics();
        status.value = `Loaded ${sample.value.name}. Documents and schema are unchanged.`;
    } catch (error) {
        editorError.value = `Cannot load sample query: ${errorMessage(error)}`;
    }
}

watch(selectedEditor, () => void mountEditor());
watch(selectedSample, loadSampleQuery);

onMounted(async () => {
    mounted = true;
    themeObserver = new MutationObserver(() => editor?.setTheme(isDark()));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    try {
        const { createSession } = await import('../src/session');
        if (!mounted) return;
        session = createSession();
        serviceReady.value = true;
        applySchema();
        await mountEditor();
    } catch (error) {
        if (!mounted) return;
        loading.value = false;
        editorError.value = `Cannot load language service: ${errorMessage(error)}`;
        status.value = 'Reload the page to retry. No queries were executed.';
    }
});

onBeforeUnmount(() => {
    mounted = false;
    generation++;
    themeObserver?.disconnect();
    editor?.dispose();
    editor = undefined;
});
</script>

<template>
    <section class="playground" :aria-labelledby="`${id}-heading`">
        <h2 :id="`${id}-heading`">SQL and schema playground</h2>

        <div class="toolbar">
            <div class="field">
                <label :for="`${id}-editor`">Editor</label>
                <select :id="`${id}-editor`" v-model="selectedEditor">
                    <option value="monaco">Monaco</option>
                    <option value="codemirror">CodeMirror</option>
                </select>
            </div>
            <div class="field">
                <label :for="`${id}-sample`">Sample</label>
                <select
                    :id="`${id}-sample`"
                    v-model="selectedSample"
                    :aria-describedby="`${id}-sample-help`"
                >
                    <option
                        v-for="item in scenarios"
                        :key="item.id"
                        :value="item.id"
                    >
                        {{ item.name }}
                    </option>
                </select>
            </div>
            <button type="button" :disabled="!ready" @click="formatQuery">
                Format
            </button>
        </div>
        <p :id="`${id}-sample-help`" class="help">
            {{ sample.description }} Selecting a sample replaces only the query.
            Your documents and applied schema are preserved.
        </p>
        <p :id="`${id}-editor-help`" class="help">
            Ctrl+Space opens completions. In Monaco, Ctrl+M toggles whether Tab
            moves focus out of the editor. CodeMirror lets Tab move focus by
            default.
        </p>
        <p role="status" aria-live="polite" aria-atomic="true" class="status">
            {{ status }}
        </p>
        <p v-if="editorError" role="alert" class="error">{{ editorError }}</p>
        <button
            v-if="editorError && !loading && serviceReady"
            type="button"
            @click="mountEditor"
        >
            Retry editor
        </button>

        <h3 :id="`${id}-query-heading`">SQL query</h3>
        <div
            ref="container"
            class="editor-host"
            role="group"
            :aria-labelledby="`${id}-query-heading`"
            :aria-describedby="`${id}-editor-help`"
            :aria-busy="loading"
        ></div>

        <section :aria-labelledby="`${id}-diagnostics-heading`">
            <h3 :id="`${id}-diagnostics-heading`">Diagnostics</h3>
            <p role="status" aria-live="polite" aria-atomic="true">
                {{ diagnostics.length }}
                {{ diagnostics.length === 1 ? 'diagnostic' : 'diagnostics' }}.
                {{ !diagnostics.length && ready ? 'No SQL syntax issues found.' : '' }}
            </p>
            <ul v-if="diagnostics.length" class="diagnostics">
                <li v-for="(diagnostic, index) in diagnostics" :key="index">
                    <strong
                        >{{ diagnostic.severity === 1 ? 'Error' : 'Warning' }}</strong
                    >
                    at line {{ diagnostic.range.startLine }}, column
                    {{ diagnostic.range.startColumn }}:
                    {{ diagnostic.message }}
                </li>
            </ul>
            <p class="help">
                Diagnostics check SQL syntax, not query results or whether every
                field exists in your data.
            </p>
        </section>

        <div class="schema-panels">
            <section
                class="documents-panel"
                :aria-labelledby="`${id}-documents-heading`"
            >
                <h3 :id="`${id}-documents-heading`">JSON documents</h3>
                <label :for="`${id}-documents`"
                    >Documents to analyze (a non-empty JSON array of
                    objects)</label
                >
                <textarea
                    :id="`${id}-documents`"
                    v-model="documents"
                    spellcheck="false"
                    :aria-invalid="!!schemaError"
                    :aria-describedby="`${id}-schema-state ${id}-schema-error`"
                ></textarea>
                <button
                    type="button"
                    :disabled="!serviceReady"
                    @click="applySchema"
                >
                    Apply schema
                </button>
                <p :id="`${id}-schema-state`" class="help" role="status">
                    {{ schemaMessage }}
                </p>
                <p :id="`${id}-schema-error`" role="alert" class="error">
                    {{ schemaError }}
                </p>
            </section>

            <section
                class="schema-panel"
                :aria-labelledby="`${id}-schema-heading`"
            >
                <h3 :id="`${id}-schema-heading`">Inferred schema</h3>
                <p class="help">
                    Inferred from the last successfully applied documents, not a
                    complete collection contract.
                </p>
                <pre
                    v-if="schemaJson"
                    tabindex="0"
                    :aria-labelledby="`${id}-schema-heading`"
                ><code>{{ schemaJson }}</code></pre>
                <p v-else>No schema applied.</p>
            </section>
        </div>
    </section>
</template>

<style scoped>
.playground {
    color: var(--cp-text);
    font-family: 'Segoe UI', Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif;
}

.playground > h2 {
    margin-top: 24px;
    padding-top: 0;
    border-top: none;
}

.toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 12px;
}

.field {
    display: grid;
    gap: 4px;
}

label {
    display: block;
    font-weight: 600;
}

button,
select,
textarea {
    border: 1px solid var(--cp-border);
    border-radius: 0.625rem;
    background: var(--cp-surface);
    color: var(--cp-text);
    font: inherit;
}

button,
select {
    min-height: 44px;
    padding: 8px 12px;
}

button {
    cursor: pointer;
}

button:hover:not(:disabled) {
    border-color: var(--cp-accent);
}

button:disabled {
    cursor: not-allowed;
    color: var(--cp-text-muted);
}

button:focus-visible,
select:focus-visible,
textarea:focus-visible,
pre:focus-visible {
    outline: 2px solid var(--cp-accent);
    outline-offset: 3px;
}

.help {
    color: var(--cp-text-muted);
    font-size: 0.9rem;
}

.status {
    min-height: 1.5em;
}

.error {
    color: var(--cp-danger);
    overflow-wrap: anywhere;
}

.editor-host {
    height: 360px;
    min-width: 0;
    border: 1px solid var(--cp-border);
    background: var(--cp-surface);
}

.diagnostics {
    max-height: 240px;
    overflow: auto;
    overflow-wrap: anywhere;
}

.schema-panels {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px;
}

.schema-panels section {
    min-width: 0;
}

textarea,
pre {
    box-sizing: border-box;
    width: 100%;
    min-height: 320px;
    padding: 12px;
    font-family: Consolas, 'Courier New', Courier, monospace;
    font-size: 0.875rem;
    line-height: 1.5;
    tab-size: 2;
}

textarea {
    resize: vertical;
    margin: 8px 0;
}

.schema-panel pre {
    max-height: 520px;
    overflow: auto;
    border: 1px solid var(--cp-border);
    border-radius: 0.625rem;
    background: var(--cp-surface);
    color: var(--cp-text);
}

.schema-panel code {
    padding: 0;
    background: var(--cp-surface);
    color: var(--cp-text);
}

@media (max-width: 760px) {
    .schema-panels {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
