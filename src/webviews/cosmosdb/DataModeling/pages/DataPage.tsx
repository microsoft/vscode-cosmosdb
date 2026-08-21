/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Input,
    makeStyles,
    Radio,
    Select,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
    tokens,
} from '@fluentui/react-components';
import { ArrowUploadRegular, DismissRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type ChangeEvent, type KeyboardEvent, useRef, useState } from 'react';
import { FieldGroup, MythBox, SubPanel, TwoColumn } from '../components/primitives';
import { type DataModel } from '../dataModel';
import { inferSchemaFromJson } from '../jsonInference';
import {
    type ArrayUpdatePattern,
    type ContainerModel,
    type PropertyRole,
    type PropertyType,
    PROPERTY_TYPES,
    type SchemaProperty,
} from '../models';
import { getArrayUpdateOptions, nextId } from '../scenarios';
import { getRoleOptions } from '../wizardState';

/**
 * Data tab of a container step. Self-contained editor for one container's schema:
 * properties, partition-key candidate, document shape and array profile. Receives
 * the whole {@link DataModel} plus a change callback and edits the active container;
 * owns no navigation or container-list management (that lives in the wizard).
 */

const useStyles = makeStyles({
    sidebar: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
    },
    tagBox: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: tokens.spacingHorizontalXS,
        alignItems: 'center',
        padding: tokens.spacingHorizontalS,
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        backgroundColor: tokens.colorNeutralBackground1,
    },
    tag: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: `2px ${tokens.spacingHorizontalS}`,
        borderRadius: tokens.borderRadiusCircular,
        backgroundColor: tokens.colorNeutralBackground4,
        fontSize: tokens.fontSizeBase200,
    },
    tagRemove: {
        cursor: 'pointer',
        border: 'none',
        background: 'transparent',
        color: tokens.colorNeutralForeground3,
        padding: 0,
        display: 'inline-flex',
        ':hover': { color: tokens.colorNeutralForeground1 },
    },
    tagInput: {
        flex: '1 1 120px',
        minWidth: '120px',
        border: 'none',
        outline: 'none',
        background: 'transparent',
        color: tokens.colorNeutralForeground1,
        fontFamily: tokens.fontFamilyBase,
        fontSize: tokens.fontSizeBase300,
    },
    tableWrap: {
        overflowX: 'auto',
    },
    cellSelect: {
        minWidth: '120px',
    },
    center: {
        textAlign: 'center',
    },
    kvGrid: {
        display: 'grid',
        gridTemplateColumns: 'minmax(160px, 1fr) minmax(0, 140px)',
        gap: tokens.spacingVerticalS,
        alignItems: 'center',
        '@media (max-width: 480px)': {
            gridTemplateColumns: '1fr',
        },
    },
    kvInput: {
        width: '100%',
        minWidth: 0,
    },
    unit: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
        minWidth: 0,
    },
    stack: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
    },
    uploadPanel: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: tokens.spacingHorizontalM,
        padding: tokens.spacingHorizontalM,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground2,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        flexWrap: 'wrap',
    },
    uploadText: {
        flex: '1 1 240px',
        minWidth: 0,
        color: tokens.colorNeutralForeground2,
    },
    uploadError: {
        color: tokens.colorPaletteRedForeground1,
    },
});

const PK_ICON = ' 🔑';

/** Pending confirmation for the destructive JSON-upload (schema replace) action. */
type PendingConfirm = { kind: 'upload'; file: File };

export interface DataPageProps {
    model: DataModel;
    scenarioLabel?: string;
    onChange: (next: DataModel) => void;
}

export function DataPage({ model, scenarioLabel, onChange }: DataPageProps) {
    const styles = useStyles();
    const [draftTag, setDraftTag] = useState('');
    const [uploadInfo, setUploadInfo] = useState<string>();
    const [uploadError, setUploadError] = useState<string>();
    const [confirm, setConfirm] = useState<PendingConfirm>();
    const fileRef = useRef<HTMLInputElement>(null);
    const roleOptions = getRoleOptions();
    const arrayOptions = getArrayUpdateOptions();

    const { containers, activeContainerId } = model;

    // Local adapter keeps the rest of the page working on containers while writing back the
    // whole DataModel. The wizard re-derives PK candidates from the updated schema.
    const onChangeContainers = (next: ContainerModel[]) => onChange({ ...model, containers: next });

    const active = containers.find((c) => c.id === activeContainerId) ?? containers[0];

    const updateActive = (updater: (c: ContainerModel) => ContainerModel) => {
        onChangeContainers(containers.map((c) => (c.id === active?.id ? updater(c) : c)));
    };

    const setEntity = (entity: string) => updateActive((c) => ({ ...c, entity }));

    const addProperty = (name: string) => {
        const trimmed = name.trim();
        if (!trimmed) {
            return;
        }
        updateActive((c) => {
            if (c.properties.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
                return c;
            }
            const prop: SchemaProperty = {
                id: nextId('prop'),
                name: trimmed,
                type: 'string',
                role: 'payload',
                pkCandidate: false,
            };
            return { ...c, properties: [...c.properties, prop] };
        });
    };

    const removeProperty = (id: string) =>
        updateActive((c) => {
            const removed = c.properties.find((p) => p.id === id);
            const properties = c.properties.filter((p) => p.id !== id);
            // If the removed property was the partition-key candidate, fall back to
            // a neutral default so the container title doesn't reference a gone field.
            const partitionKey = removed?.pkCandidate ? '/id' : c.partitionKey;
            return { ...c, properties, partitionKey };
        });

    const patchProperty = (id: string, patch: Partial<SchemaProperty>) =>
        updateActive((c) => ({
            ...c,
            properties: c.properties.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        }));

    // Partition-key candidate is single-select per container: choosing one clears
    // the others and updates the container's partition-key path.
    const setPkCandidate = (id: string) =>
        updateActive((c) => {
            const properties = c.properties.map((p) => ({ ...p, pkCandidate: p.id === id }));
            const selected = properties.find((p) => p.id === id);
            return { ...c, properties, partitionKey: selected ? `/${selected.name}` : c.partitionKey };
        });

    const onUploadClick = () => {
        setUploadError(undefined);
        fileRef.current?.click();
    };

    // Selecting a file only stages it; the actual replace runs after the user
    // confirms (parsing an object/array is destructive to the current schema).
    const onFileSelected = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        // Reset so selecting the same file again re-triggers change.
        e.target.value = '';
        if (!file) {
            return;
        }
        setUploadError(undefined);
        setConfirm({ kind: 'upload', file });
    };

    const applyUpload = async (file: File) => {
        try {
            const text = await file.text();
            const schema = inferSchemaFromJson(text);
            updateActive((c) => ({
                ...c,
                properties: schema.properties.map((p) => ({ id: nextId('prop'), ...p })),
                partitionKey: schema.partitionKey,
            }));
            setUploadInfo(file.name);
            setUploadError(undefined);
        } catch {
            setUploadInfo(undefined);
            setUploadError(
                l10n.t('Could not read {file}. Make sure it is a JSON object or an array of objects.', {
                    file: file.name,
                }),
            );
        }
    };

    const onConfirm = async () => {
        const pending = confirm;
        setConfirm(undefined);
        if (!pending) {
            return;
        }
        await applyUpload(pending.file);
    };

    const onTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addProperty(draftTag);
            setDraftTag('');
        }
    };

    const patchDocument = (patch: Partial<ContainerModel['document']>) =>
        updateActive((c) => ({ ...c, document: { ...c.document, ...patch } }));

    const patchArrays = (patch: Partial<ContainerModel['arrays']>) =>
        updateActive((c) => ({ ...c, arrays: { ...c.arrays, ...patch } }));

    if (!active) {
        return null;
    }

    return (
        <div>
            <TwoColumn>
                <aside className={styles.sidebar}>
                    <SubPanel title={l10n.t('Why this matters')}>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                            <li>{l10n.t('PK must exist on every document')}</li>
                            <li>{l10n.t('High-cardinality = better distribution')}</li>
                            <li>{l10n.t('Avoid mutable fields like status')}</li>
                        </ul>
                    </SubPanel>
                    {scenarioLabel ? (
                        <MythBox icon="✨">
                            {l10n.t('Pre-filled a {scenario} sample template. Edit the properties to match your app.', {
                                scenario: scenarioLabel,
                            })}
                        </MythBox>
                    ) : null}
                </aside>

                <div className={styles.stack}>
                    <FieldGroup label={l10n.t('Entity name')}>
                        <Input
                            value={active.entity}
                            placeholder={l10n.t('e.g., Orders')}
                            onChange={(_, data) => setEntity(data.value)}
                        />
                    </FieldGroup>

                    <div className={styles.uploadPanel}>
                        <Text className={styles.uploadText}>
                            {l10n.t('Upload your JSON documents to infer the schema for this container')}
                        </Text>
                        <Button appearance="primary" icon={<ArrowUploadRegular />} onClick={onUploadClick}>
                            {l10n.t('Upload JSON')}
                        </Button>
                        <input
                            ref={fileRef}
                            type="file"
                            accept="application/json,.json"
                            style={{ display: 'none' }}
                            onChange={onFileSelected}
                        />
                    </div>
                    {uploadInfo ? (
                        <MythBox icon="📄">
                            {l10n.t('Inferred schema from {file}. Review the PK candidate below and edit as needed.', {
                                file: uploadInfo,
                            })}
                        </MythBox>
                    ) : null}
                    {uploadError ? <Text className={styles.uploadError}>{uploadError}</Text> : null}

                    <FieldGroup
                        label={l10n.t('Key & filter properties')}
                        hint={l10n.t(
                            'Add the business/unique key identifiers and the attributes you filter queries by. Press Enter to add.',
                        )}
                    >
                        <div className={styles.tagBox}>
                            {active.properties.map((p) => (
                                <span key={p.id} className={styles.tag}>
                                    {p.name}
                                    {p.pkCandidate ? PK_ICON : ''}
                                    <button
                                        type="button"
                                        className={styles.tagRemove}
                                        aria-label={l10n.t('Remove {name}', { name: p.name })}
                                        onClick={() => removeProperty(p.id)}
                                    >
                                        <DismissRegular fontSize={12} />
                                    </button>
                                </span>
                            ))}
                            <input
                                className={styles.tagInput}
                                placeholder={l10n.t('Add property…')}
                                value={draftTag}
                                onChange={(e) => setDraftTag(e.target.value)}
                                onKeyDown={onTagKeyDown}
                            />
                        </div>
                    </FieldGroup>

                    <div className={styles.tableWrap}>
                        <Table size="small" aria-label={l10n.t('Schema properties')}>
                            <TableHeader>
                                <TableRow>
                                    <TableHeaderCell>{l10n.t('Property')}</TableHeaderCell>
                                    <TableHeaderCell>{l10n.t('Type')}</TableHeaderCell>
                                    <TableHeaderCell>{l10n.t('Role')}</TableHeaderCell>
                                    <TableHeaderCell className={styles.center}>
                                        {l10n.t('PK candidate')}
                                    </TableHeaderCell>
                                    <TableHeaderCell />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {active.properties.map((p) => (
                                    <TableRow key={p.id}>
                                        <TableCell>{p.name}</TableCell>
                                        <TableCell>
                                            <Select
                                                className={styles.cellSelect}
                                                value={p.type}
                                                onChange={(_, data) =>
                                                    patchProperty(p.id, { type: data.value as PropertyType })
                                                }
                                            >
                                                {PROPERTY_TYPES.map((t) => (
                                                    <option key={t} value={t}>
                                                        {t}
                                                    </option>
                                                ))}
                                            </Select>
                                        </TableCell>
                                        <TableCell>
                                            <Select
                                                className={styles.cellSelect}
                                                value={p.role}
                                                onChange={(_, data) =>
                                                    patchProperty(p.id, { role: data.value as PropertyRole })
                                                }
                                            >
                                                {roleOptions.map((o) => (
                                                    <option key={o.value} value={o.value}>
                                                        {o.label}
                                                    </option>
                                                ))}
                                            </Select>
                                        </TableCell>
                                        <TableCell className={styles.center}>
                                            <Radio
                                                name={`pk-${active.id}`}
                                                value={p.id}
                                                checked={p.pkCandidate}
                                                aria-label={l10n.t('Use {name} as partition key', { name: p.name })}
                                                onChange={() => setPkCandidate(p.id)}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                icon={<DismissRegular />}
                                                appearance="subtle"
                                                size="small"
                                                aria-label={l10n.t('Remove {name}', { name: p.name })}
                                                onClick={() => removeProperty(p.id)}
                                            />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>

                    <SubPanel
                        title={l10n.t('📐 Document shape & size')}
                        subtitle={l10n.t(
                            'RU cost and the 20 GB partition limit scale with document size. Estimate the overall shape here instead of listing every property.',
                        )}
                    >
                        <div className={styles.kvGrid}>
                            <Text>{l10n.t('Total attributes per document')}</Text>
                            <Input
                                className={styles.kvInput}
                                type="number"
                                aria-label={l10n.t('Total attributes per document')}
                                value={String(active.document.attributeCount)}
                                onChange={(_, data) => patchDocument({ attributeCount: Number(data.value) || 0 })}
                            />
                            <Text>{l10n.t('Average document size')}</Text>
                            <div className={styles.unit}>
                                <Input
                                    className={styles.kvInput}
                                    type="number"
                                    aria-label={l10n.t('Average document size')}
                                    value={String(active.document.avgSizeKb)}
                                    onChange={(_, data) => patchDocument({ avgSizeKb: Number(data.value) || 0 })}
                                />
                                <Text>{'KB'}</Text>
                            </div>
                            <Text>{l10n.t('Maximum document size')}</Text>
                            <div className={styles.unit}>
                                <Input
                                    className={styles.kvInput}
                                    type="number"
                                    aria-label={l10n.t('Maximum document size')}
                                    value={String(active.document.maxSizeKb)}
                                    onChange={(_, data) => patchDocument({ maxSizeKb: Number(data.value) || 0 })}
                                />
                                <Text>{'KB'}</Text>
                            </div>
                        </div>
                    </SubPanel>

                    <SubPanel
                        title={l10n.t('📚 Arrays & nested collections')}
                        subtitle={l10n.t(
                            'Large or frequently-patched arrays inflate document size and RU cost, and can trigger the 2 MB item limit.',
                        )}
                    >
                        <Checkbox
                            checked={active.arrays.hasArrays}
                            label={l10n.t('This container has arrays / nested collections')}
                            onChange={(_, data) => patchArrays({ hasArrays: !!data.checked })}
                        />
                        {active.arrays.hasArrays ? (
                            <div className={styles.kvGrid}>
                                <Text>{l10n.t('Average items per array')}</Text>
                                <Input
                                    type="number"
                                    value={String(active.arrays.avgItems)}
                                    onChange={(_, data) => patchArrays({ avgItems: Number(data.value) || 0 })}
                                />
                                <Text>{l10n.t('Maximum items per array')}</Text>
                                <Input
                                    type="number"
                                    value={String(active.arrays.maxItems)}
                                    onChange={(_, data) => patchArrays({ maxItems: Number(data.value) || 0 })}
                                />
                                <Text>{l10n.t('Array update pattern')}</Text>
                                <Select
                                    value={active.arrays.updatePattern}
                                    onChange={(_, data) =>
                                        patchArrays({ updatePattern: data.value as ArrayUpdatePattern })
                                    }
                                >
                                    {arrayOptions.map((o) => (
                                        <option key={o.value} value={o.value}>
                                            {o.label}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                        ) : null}
                    </SubPanel>
                </div>
            </TwoColumn>

            <Dialog
                open={!!confirm}
                onOpenChange={(_, data) => {
                    if (!data.open) {
                        setConfirm(undefined);
                    }
                }}
            >
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>{l10n.t('Replace schema?')}</DialogTitle>
                        <DialogContent>
                            {confirm
                                ? l10n.t('Replace the properties of “{entity}” with the schema inferred from {file}?', {
                                      entity: active.entity,
                                      file: confirm.file.name,
                                  })
                                : ''}
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="secondary" onClick={() => setConfirm(undefined)}>
                                {l10n.t('Cancel')}
                            </Button>
                            <Button appearance="primary" onClick={() => void onConfirm()}>
                                {l10n.t('Yes')}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </div>
    );
}
