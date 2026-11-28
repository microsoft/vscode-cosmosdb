/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { markdownSections } from '../../../skills/cosmosdb-relational-migration/scripts/phase-summary.mjs';

export function checkPlanTasks(markdown) {
    const sections = new Map(
        [...markdownSections(markdown)].map(([heading, content]) => [
            heading.toLowerCase(),
            content.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ''),
        ]),
    );
    const tasks = new Map();
    for (const [section, prefix] of [
        ['ordered changes', 'CM'],
        ['operational handoff', 'OP'],
    ]) {
        const content = sections.get(section) ?? '';
        const entries = [...content.matchAll(/^\s*[-*] \[([ xX])\]\s+((?:CM|OP)-\d+)\s+\(([^)]+)\):[^\n]+/gm)];
        assert.equal(
            entries.length,
            (content.match(/^\s*[-*] \[[^\]]\]\s+(?:CM|OP)-/gm) ?? []).length,
            `${section}: malformed task declaration`,
        );
        if (prefix === 'CM')
            assert.ok(entries.length, 'Ordered Changes must contain implementation/verification tasks');
        for (const [index, entry] of entries.entries()) {
            const [, checkbox, id, status] = entry;
            assert.ok(id.startsWith(`${prefix}-`), `${id} is in the wrong checklist`);
            assert.ok(!tasks.has(id), `Duplicate task: ${id}`);
            assert.equal(checkbox, ' ', `${id}: planning must not check off execution`);
            assert.equal(status, 'pending', `${id}: execution must remain pending`);
            const body = content.slice(entry.index + entry[0].length, entries[index + 1]?.index ?? content.length);
            const fields = [...body.matchAll(/^\s*(?:[-*]\s+)?Depends on:\s*(.+)$/gim)];
            assert.equal(fields.length, 1, `${id}: declare dependencies exactly once`);
            const dependencyText = fields[0][1].replace(/`/g, '');
            const dependencies = dependencyText.match(/\b(?:CM|OP)-[\w-]+/g) ?? [];
            assert.ok(dependencies.length || /^none[.]?$/i.test(dependencyText.trim()), `${id}: use task IDs or none`);
            assert.equal(new Set(dependencies).size, dependencies.length, `${id}: duplicate dependencies`);
            assert.match(body, /Done when:\s*\S/i, `${id}: missing completion condition`);
            tasks.set(id, dependencies);
        }
    }
    for (const [id, dependencies] of tasks) {
        for (const dependency of dependencies) {
            assert.ok(tasks.has(dependency), `${id}: unknown prerequisite ${dependency}`);
            assert.notEqual(dependency, id, `${id}: self dependency`);
            assert.ok(
                !id.startsWith('CM-') || !dependency.startsWith('OP-'),
                `${id}: implementation verification must not depend on production handoff ${dependency}`,
            );
        }
    }
    const active = new Set();
    const visited = new Set();
    const visit = (id) => {
        assert.ok(!active.has(id), `Task dependency cycle through ${id}`);
        if (visited.has(id)) return;
        active.add(id);
        for (const dependency of tasks.get(id)) visit(dependency);
        active.delete(id);
        visited.add(id);
    };
    for (const id of tasks.keys()) visit(id);
    return tasks;
}
