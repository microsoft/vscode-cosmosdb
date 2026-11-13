/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { createBlankContainer } from '../webviews/cosmosdb/DataModeling/dataModel';
import { ModelingAdvisorSnapshotSchema, WizardStateSchema } from './modelingAdvisorSchema';

describe('wizard document size validation', () => {
    it.each(['avgSizeKb', 'maxSizeKb'] as const)(
        'rejects negative %s in requests but preserves saved drafts',
        (field) => {
            const container = createBlankContainer();
            const wizard = {
                step: 1,
                dataModel: { containers: [container], activeContainerId: container.id },
            };
            for (const value of [-1, -0.01]) {
                container.document[field] = value;
                const result = WizardStateSchema.safeParse(wizard);
                expect(result.success).toBe(false);
                expect(result.error?.issues).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ path: ['dataModel', 'containers', 0, 'document', field] }),
                    ]),
                );
                const snapshot = ModelingAdvisorSnapshotSchema.safeParse({
                    wizard,
                    recommendation: { status: 'idle' },
                });
                expect(snapshot.success).toBe(true);
                expect(snapshot.data?.wizard.dataModel.containers[0].document[field]).toBe(value);
            }
        },
    );

    it.each(['avgSizeKb', 'maxSizeKb'] as const)(
        'validates %s against 2048 KB without clamping saved drafts',
        (field) => {
            const container = createBlankContainer();
            container.document.avgSizeKb = 0;
            container.document.maxSizeKb = 2048;
            const wizard = {
                step: 1,
                dataModel: { containers: [container], activeContainerId: container.id },
            };
            const parsedSize = (value: number) => {
                container.document[field] = value;
                return WizardStateSchema.parse(wizard).dataModel.containers[0].document[field];
            };
            for (const value of [0, 1.5, 2047.99, 2048]) {
                expect(parsedSize(value)).toBe(value);
            }
            for (const value of [2048.01, 2049, 49999]) {
                container.document[field] = value;
                const result = WizardStateSchema.safeParse(wizard);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]).toMatchObject({
                    path: ['dataModel', 'containers', 0, 'document', field],
                    message: 'Document size cannot exceed 2 MB (2048 KB).',
                });
                expect(
                    ModelingAdvisorSnapshotSchema.parse({ wizard, recommendation: { status: 'idle' } }).wizard.dataModel
                        .containers[0].document[field],
                ).toBe(value);
            }
            for (const value of [Infinity, NaN]) {
                container.document[field] = value;
                const result = WizardStateSchema.safeParse(wizard);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0].path).toEqual(['dataModel', 'containers', 0, 'document', field]);
            }
        },
    );

    it.each([
        { average: 1, maximum: 4, valid: true },
        { average: 4, maximum: 4, valid: true },
        { average: 0, maximum: 0, valid: true },
        { average: 2048, maximum: 2048, valid: true },
        { average: 4.01, maximum: 4, valid: false },
        { average: 2048, maximum: 28, valid: false },
    ])('validates average $average against maximum $maximum', ({ average, maximum, valid }) => {
        const container = createBlankContainer();
        container.document.avgSizeKb = average;
        container.document.maxSizeKb = maximum;
        const wizard = { step: 1, dataModel: { containers: [container], activeContainerId: container.id } };
        const result = WizardStateSchema.safeParse(wizard);
        expect(result.success).toBe(valid);
        expect(result.error?.issues[0].path).toEqual(
            valid ? undefined : ['dataModel', 'containers', 0, 'document', 'avgSizeKb'],
        );
        expect(ModelingAdvisorSnapshotSchema.parse({ wizard, recommendation: { status: 'idle' } }).wizard).toEqual(
            wizard,
        );
    });

    it('rejects inconsistent estimates in inactive containers too', () => {
        const first = createBlankContainer('First');
        const second = createBlankContainer('Second');
        second.document.avgSizeKb = 8;
        const result = WizardStateSchema.safeParse({
            step: 1,
            dataModel: { containers: [first, second], activeContainerId: first.id },
        });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].path).toEqual(['dataModel', 'containers', 1, 'document', 'avgSizeKb']);
    });
});

describe('wizard workload limit validation', () => {
    const wizardFor = (container: ReturnType<typeof createBlankContainer>) => ({
        step: 1,
        dataModel: { containers: [container], activeContainerId: container.id },
    });

    it.each([0, 2, 4, 10_000])('rejects a mismatched attribute total of %s but preserves it in drafts', (count) => {
        const first = createBlankContainer('First');
        const second = createBlankContainer('Second');
        second.document.attributeCount = count;
        const wizard = {
            step: 1,
            dataModel: { containers: [first, second], activeContainerId: first.id },
        };
        const result = WizardStateSchema.safeParse(wizard);
        expect(result.success).toBe(false);
        expect(result.error?.issues).toEqual([
            expect.objectContaining({
                path: ['dataModel', 'containers', 1, 'document', 'attributeCount'],
                message: 'Total attributes per document must match the 3 attributes in the schema properties table.',
            }),
        ]);
        expect(ModelingAdvisorSnapshotSchema.parse({ wizard, recommendation: { status: 'idle' } }).wizard).toEqual(
            wizard,
        );

        second.document.attributeCount = second.properties.length;
        expect(WizardStateSchema.safeParse(wizard).success).toBe(true);
        second.properties = [];
        second.document.attributeCount = 0;
        expect(WizardStateSchema.safeParse(wizard).success).toBe(true);
    });

    it('preserves invalid Data-tab counts while still normalizing legacy operation rates', () => {
        const container = createBlankContainer();
        container.document.attributeCount = 50_000;
        container.arrays = { hasArrays: true, avgItems: -2.5, maxItems: 250_000.4, updatePattern: 'none' };
        container.reads[0].qps = 12.6;
        container.writes = { insertsPerSec: -5, updatesPerSec: 5_000_000, deletesPerSec: 1.2 };
        const loaded = ModelingAdvisorSnapshotSchema.parse({
            wizard: wizardFor(container),
            recommendation: { status: 'idle' },
        }).wizard.dataModel.containers[0];
        expect(loaded.document.attributeCount).toBe(50_000);
        expect(loaded.arrays).toMatchObject({ avgItems: -2.5, maxItems: 250_000.4 });
        expect(loaded.reads[0].qps).toBe(13);
        expect(loaded.writes).toEqual({ insertsPerSec: 0, updatesPerSec: 1_000_000, deletesPerSec: 1 });
    });

    it.each([
        { section: 'document', field: 'attributeCount', value: -1, message: 'Value cannot be negative.' },
        { section: 'document', field: 'attributeCount', value: 3.5, message: 'Enter a whole number.' },
        {
            section: 'document',
            field: 'attributeCount',
            value: 10_001,
            message: `Value cannot exceed ${(10_000).toLocaleString()}.`,
        },
        { section: 'arrays', field: 'avgItems', value: -1, message: 'Value cannot be negative.' },
        {
            section: 'arrays',
            field: 'avgItems',
            value: 100_001,
            message: `Value cannot exceed ${(100_000).toLocaleString()}.`,
        },
        { section: 'arrays', field: 'maxItems', value: 1.5, message: 'Enter a whole number.' },
        {
            section: 'arrays',
            field: 'maxItems',
            value: 100_001,
            message: `Value cannot exceed ${(100_000).toLocaleString()}.`,
        },
    ] as const)(
        'reports $section.$field = $value without changing the saved value',
        ({ section, field, value, message }) => {
            const container = createBlankContainer();
            container.arrays.hasArrays = true;
            if (field === 'attributeCount') {
                container.document[field] = value;
            } else {
                container.arrays[field] = value;
            }
            const wizard = wizardFor(container);
            const result = WizardStateSchema.safeParse(wizard);
            expect(result.success).toBe(false);
            expect(result.error?.issues).toEqual([
                expect.objectContaining({ path: ['dataModel', 'containers', 0, section, field], message }),
            ]);
            expect(ModelingAdvisorSnapshotSchema.parse({ wizard, recommendation: { status: 'idle' } }).wizard).toEqual(
                wizard,
            );
        },
    );

    it('rejects non-finite counts', () => {
        const container = createBlankContainer();
        container.reads[0].qps = NaN;
        const result = WizardStateSchema.safeParse(wizardFor(container));
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].path).toEqual(['dataModel', 'containers', 0, 'reads', 0, 'qps']);
    });

    it('rejects average array items above the maximum only when the container has arrays', () => {
        const container = createBlankContainer();
        container.arrays = { hasArrays: true, avgItems: 101, maxItems: 100, updatePattern: 'none' };
        const result = WizardStateSchema.safeParse(wizardFor(container));
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].path).toEqual(['dataModel', 'containers', 0, 'arrays', 'avgItems']);
        expect(
            ModelingAdvisorSnapshotSchema.safeParse({
                wizard: wizardFor(container),
                recommendation: { status: 'idle' },
            }).success,
        ).toBe(true);

        container.arrays.hasArrays = false;
        expect(WizardStateSchema.safeParse(wizardFor(container)).success).toBe(true);
    });

    it('blocks requests for unrealistic throughput but only warns at the service limits', () => {
        const container = createBlankContainer();
        container.document.avgSizeKb = 10;
        container.document.maxSizeKb = 10;
        // 10 RU per read: 1,000,000 QPS = 10,000,000 RU/s, the inclusive ceiling.
        container.reads[0].qps = 1_000_000;
        container.scale.writes = 'skewed';
        container.writes.insertsPerSec = 1_000;
        expect(WizardStateSchema.safeParse(wizardFor(container)).success).toBe(false);

        container.writes.insertsPerSec = 0;
        expect(WizardStateSchema.safeParse(wizardFor(container)).success).toBe(true);

        container.reads.push({ id: 'second', pattern: '', query: '', qps: 1 });
        const result = WizardStateSchema.safeParse(wizardFor(container));
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].path).toEqual(['dataModel', 'containers', 0]);
        expect(result.error?.issues[0].message).toContain(`${(10_000_010).toLocaleString()} RU/s`);
    });

    it('requires a description or query for each read in requests but still loads drafts without them', () => {
        const container = createBlankContainer();
        container.reads = [{ id: 'empty', pattern: ' ', query: ' ', qps: 1 }];
        const result = WizardStateSchema.safeParse(wizardFor(container));
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].path).toEqual(['dataModel', 'containers', 0, 'reads', 0]);
        expect(result.error?.issues[0].message).toBe('Read query 1 needs a description or a query.');
        expect(
            ModelingAdvisorSnapshotSchema.safeParse({
                wizard: wizardFor(container),
                recommendation: { status: 'idle' },
            }).success,
        ).toBe(true);

        for (const read of [
            { pattern: 'Get orders for a customer', query: undefined },
            { pattern: '', query: 'SELECT * FROM c WHERE c.customerId = @id' },
        ]) {
            container.reads = [{ id: 'read', qps: 1, ...read }];
            expect(WizardStateSchema.safeParse(wizardFor(container)).success).toBe(true);
        }
    });

    it.each([{ filters: 'removed = @value' }, { filters: ['removed'] }])(
        'discards legacy read filters $filters from saved projects and requests',
        ({ filters }) => {
            const container = createBlankContainer();
            const read = container.reads[0];
            const legacyRead = { ...read, filters };
            const wizard = wizardFor({ ...container, reads: [legacyRead] });
            const loaded = ModelingAdvisorSnapshotSchema.parse({
                wizard,
                recommendation: { status: 'idle' },
            }).wizard;
            const requested = WizardStateSchema.parse(wizard);
            expect(loaded.dataModel.containers[0].reads[0]).toEqual(read);
            expect(requested.dataModel.containers[0].reads[0]).toEqual(read);
            expect(loaded.dataModel.containers[0].reads[0]).not.toHaveProperty('filters');
            expect(requested.dataModel.containers[0].reads[0]).not.toHaveProperty('filters');
        },
    );
});
