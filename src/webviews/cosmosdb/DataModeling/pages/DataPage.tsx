/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Checkbox,
    Dropdown,
    Field,
    Input,
    makeStyles,
    Option,
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
import { ArrowUploadRegular, DismissRegular, WarningRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import {
    type ChangeEvent,
    type KeyboardEvent,
    type SetStateAction,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import { type ModelingTelemetryEvent } from '../../../../dataModeling/modelingTelemetrySchema';
import { InlineGuidance, MythBox, SubPanel } from '../components/primitives';
import { type DataModel } from '../dataModel';
import { AttributeCountLimitError, DocumentSizeLimitError, inferSchemaFromJson } from '../jsonInference';
import {
    type ArrayUpdatePattern,
    type ContainerModel,
    MAX_DOCUMENT_SIZE_KB,
    type PropertyType,
    PROPERTY_TYPES,
    type SchemaProperty,
} from '../models';
import { getPartitionKeyRestriction } from '../partitionKeyEligibility';
import { getArrayUpdateOptions, nextId } from '../scenarios';
import { SchemaImportTracker } from '../schemaImports';
import { useNativeConfirmation } from '../useNativeConfirmation';
import { getRoleOptions } from '../wizardState';
import {
    type DataNumberField,
    getDataFieldErrors,
    MAX_ARRAY_ITEMS,
    MAX_ATTRIBUTE_COUNT,
    parseCountInput,
} from '../workloadLimits';

/**
 * Data tab of a container step. Self-contained editor for one container's schema:
 * properties, partition-key candidate, document shape and array profile. Receives
 * the whole {@link DataModel} plus a change callback and edits the active container;
 * owns no navigation or container-list management (that lives in the wizard).
 */

const useStyles = makeStyles({
    tagBox: {
        display: 'flex',
        flex: '1 1 280px',
        minWidth: 0,
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
    roleDropdown: {
        width: '260px',
        minWidth: '260px',
    },
    roleControls: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
    },
    roleListbox: {
        width: 'max-content',
        maxWidth: 'calc(100vw - 32px)',
    },
    roleOption: {
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr)',
        columnGap: tokens.spacingHorizontalXS,
        alignItems: 'baseline',
        textAlign: 'left',
        whiteSpace: 'normal',
        // Follows Fluent's committed selection (aria-selected); arrow-key navigation shows the focus ring instead.
        // Native select highlight; engines without system colours fall back to the theme menu colours.
        '&[aria-selected="true"], &[aria-selected="true"]:hover, &[aria-selected="true"]:active': {
            backgroundColor: ['var(--vscode-menu-selectionBackground)', 'SelectedItem'],
            color: ['var(--vscode-menu-selectionForeground)', 'SelectedItemText'],
        },
    },
    roleOptionHeading: {
        gridColumn: '2',
        whiteSpace: 'nowrap',
    },
    roleOptionDescription: {
        gridColumn: '2',
    },
    propertyWarning: {
        display: 'inline-flex',
        alignItems: 'flex-start',
        gap: tokens.spacingHorizontalXS,
        color: 'var(--vscode-editorWarning-foreground)',
    },
    warningIcon: {
        flexShrink: 0,
    },
    kvGrid: {
        display: 'grid',
        maxWidth: '560px',
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
    kvField: {
        gridColumn: '1 / -1',
        gridTemplateColumns: 'subgrid',
        gridTemplateRows: 'auto',
        alignItems: 'center',
        minWidth: 0,
        '& > .fui-Field__label': {
            gridRow: 'auto',
        },
    },
    fieldError: {
        gridColumn: '1 / -1',
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
        minWidth: 0,
        gap: tokens.spacingVerticalM,
    },
    propertyInputRow: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalM,
        flexWrap: 'wrap',
    },
    uploadError: {
        color: tokens.colorPaletteRedForeground1,
    },
});

export interface DataPageProps {
    model: DataModel;
    onChange: (next: SetStateAction<DataModel>) => void;
    onTelemetry?: (event: ModelingTelemetryEvent) => void;
    /** Shared by the wizard so imports survive remounts; a standalone page tracks its own imports. */
    schemaImports?: SchemaImportTracker;
}

export function DataPage({ model, onChange, onTelemetry, schemaImports }: DataPageProps) {
    const styles = useStyles();
    const [draftTag, setDraftTag] = useState('');
    const [uploadContainerId, setUploadContainerId] = useState<string>();
    const [uploadInfo, setUploadInfo] = useState<string>();
    const [uploadError, setUploadError] = useState<string>();
    const [numberDrafts, setNumberDrafts] = useState<Partial<Record<DataNumberField, string>>>({});
    const sizeLimitMessage = l10n.t('Document size cannot exceed 2 MB (2048 KB).');
    const { confirm, confirmationError } = useNativeConfirmation();
    const fileRef = useRef<HTMLInputElement>(null);
    const uploadButtonRef = useRef<HTMLButtonElement>(null);
    const roleOptions = getRoleOptions();
    const arrayOptions = getArrayUpdateOptions();

    const { containers, activeContainerId } = model;

    const currentModel = useRef(model);
    const [localImports] = useState(() => new SchemaImportTracker());
    const imports = schemaImports ?? localImports;
    const confirmingImport = useRef(false);
    const mounted = useRef(false);
    useLayoutEffect(() => {
        currentModel.current = model;
    }, [model]);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    const active = containers.find((c) => c.id === activeContainerId) ?? containers[0];
    useEffect(() => {
        setUploadInfo(undefined);
        setUploadError(undefined);
        setNumberDrafts({});
    }, [active?.id]);
    useEffect(() => {
        // The inferred properties retain their identity through candidate derivation.
        // Only acknowledge imports present in the committed model, never a preview of an updater.
        for (const request of imports.acknowledge(model)) {
            onTelemetry?.({ type: 'schemaImport', outcome: 'success' });
            if (active?.id !== request.containerId) continue;
            setUploadContainerId(request.containerId);
            setUploadInfo(request.fileName);
            setUploadError(undefined);
            setNumberDrafts((previous) => ({
                ...previous,
                attributeCount: undefined,
                avgSizeKb: undefined,
                maxSizeKb: undefined,
            }));
            uploadButtonRef.current?.focus();
        }
    }, [model, imports, active?.id, onTelemetry]);
    useEffect(() => {
        const input = fileRef.current;
        const onCancel = () => onTelemetry?.({ type: 'schemaImport', outcome: 'cancelled' });
        input?.addEventListener('cancel', onCancel);
        return () => input?.removeEventListener('cancel', onCancel);
    }, [active?.id, onTelemetry]);

    const updateActive = (updater: (c: ContainerModel) => ContainerModel) => {
        const targetId = active?.id;
        onChange((previous) =>
            previous.containers.some((c) => c.id === targetId)
                ? { ...previous, containers: previous.containers.map((c) => (c.id === targetId ? updater(c) : c)) }
                : previous,
        );
    };

    const addProperty = (name: string) => {
        const trimmed = name.trim();
        if (!trimmed) {
            return;
        }
        const willAdd = active && !active.properties.some((p) => p.name.toLowerCase() === trimmed.toLowerCase());
        const prop: SchemaProperty = {
            id: nextId('prop'),
            name: trimmed,
            type: 'string',
            role: 'payload',
            pkCandidate: false,
        };
        updateActive((c) => {
            if (c.properties.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
                return c;
            }
            const properties = [...c.properties, prop];
            return {
                ...c,
                properties,
                document: { ...c.document, attributeCount: Math.max(c.document.attributeCount, properties.length) },
            };
        });
        if (willAdd) onTelemetry?.({ type: 'fieldAdded' });
    };

    const removeProperty = (id: string) =>
        updateActive((c) => {
            const removed = c.properties.find((p) => p.id === id);
            const properties = c.properties.filter((p) => p.id !== id);
            const partitionKey = c.partitionKey === `/${removed?.name}` ? '/id' : c.partitionKey;
            return { ...c, properties, partitionKey };
        });

    const patchProperty = (id: string, patch: Partial<SchemaProperty>) =>
        updateActive((c) => ({
            ...c,
            properties: c.properties.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        }));

    const onUploadClick = () => {
        onTelemetry?.({ type: 'control', control: 'schemaUpload' });
        setUploadError(undefined);
        fileRef.current?.click();
    };

    const onFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        // Reset so selecting the same file again re-triggers change.
        e.target.value = '';
        if (!file || !active || confirmingImport.current) {
            return;
        }
        // Keep the original target through confirmation and reading, even if this page unmounts.
        // A newer selection for this container supersedes this request, even if the older read finishes last.
        const targetId = active.id;
        const request = imports.start(targetId, file.name);
        const isCurrent = () =>
            imports.isCurrent(request) && currentModel.current.containers.some((c) => c.id === targetId);
        const isVisible = () => {
            const latest = currentModel.current;
            const visible = latest.containers.find((c) => c.id === latest.activeContainerId) ?? latest.containers[0];
            return visible?.id === targetId;
        };
        setUploadContainerId(targetId);
        setUploadError(undefined);
        confirmingImport.current = true;
        const result = await confirm(
            l10n.t('Replace schema?'),
            l10n.t('Replace the properties of “{entity}” with the schema inferred from {file}?', {
                entity: active.entity,
                file: file.name,
            }),
        );
        confirmingImport.current = false;
        if (!isCurrent()) return;
        if (result !== true) {
            onTelemetry?.({ type: 'schemaImport', outcome: 'cancelled' });
            if (isVisible()) uploadButtonRef.current?.focus();
            return;
        }

        try {
            const text = await file.text();
            if (!isCurrent()) return;
            const schema = inferSchemaFromJson(text);
            const properties = schema.properties.map((p) => ({ id: nextId('prop'), ...p }));
            request.properties = properties;
            onChange((previous) => {
                if (!isCurrent() || !previous.containers.some((c) => c.id === targetId)) return previous;
                return {
                    ...previous,
                    containers: previous.containers.map((c) =>
                        c.id === targetId
                            ? {
                                  ...c,
                                  properties,
                                  partitionKey: schema.partitionKey,
                                  document: schema.document,
                                  arrays: { ...c.arrays, hasArrays: schema.hasNestedCollections },
                              }
                            : c,
                    ),
                };
            });
        } catch (error) {
            if (!isCurrent()) return;
            onTelemetry?.({ type: 'schemaImport', outcome: 'error' });
            if (!mounted.current || !isVisible()) return;
            setUploadContainerId(targetId);
            setUploadInfo(undefined);
            setUploadError(
                error instanceof DocumentSizeLimitError
                    ? sizeLimitMessage
                    : error instanceof AttributeCountLimitError
                      ? l10n.t(
                            '{file} contains {count} distinct attributes, more than the limit of {max}. Upload a smaller sample of documents.',
                            {
                                file: file.name,
                                count: error.attributeCount.toLocaleString(),
                                max: MAX_ATTRIBUTE_COUNT.toLocaleString(),
                            },
                        )
                      : l10n.t('Could not read {file}. Make sure it is a JSON object or an array of objects.', {
                            file: file.name,
                        }),
            );
            uploadButtonRef.current?.focus();
        }
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

    const patchNumber = (field: DataNumberField, raw: string) => {
        setNumberDrafts((previous) => ({ ...previous, [field]: raw }));
        const value = parseCountInput(raw);
        if (field === 'avgItems' || field === 'maxItems') {
            patchArrays({ [field]: value });
        } else {
            patchDocument({ [field]: value });
        }
    };

    const numberInput = (field: DataNumberField) => {
        const value = field === 'avgItems' || field === 'maxItems' ? active.arrays[field] : active.document[field];
        const draft = numberDrafts[field];
        return {
            value: draft !== undefined && parseCountInput(draft) === value ? draft : String(value),
            onChange: (_: ChangeEvent<HTMLInputElement>, data: { value: string }) => patchNumber(field, data.value),
            onBlur: () => setNumberDrafts((previous) => ({ ...previous, [field]: undefined })),
        };
    };

    const fieldValidation = (error: string | undefined) => ({
        validationState: error ? ('error' as const) : ('none' as const),
        validationMessage: error ? { children: error, role: 'alert', className: styles.fieldError } : undefined,
    });

    if (!active) {
        return null;
    }

    const errors = getDataFieldErrors(active);
    const attributeCountLabel = l10n.t('Total attributes per document');
    const averageItemsLabel = l10n.t('Average items per array');
    const maximumItemsLabel = l10n.t('Maximum items per array');

    return (
        <div className={styles.stack}>
            <SubPanel
                title={l10n.t('Key & filter properties')}
                subtitle={l10n.t(
                    'Add the business/unique key identifiers and the attributes you filter queries by. Press Enter to add.',
                )}
            >
                <InlineGuidance title={l10n.t('Partition-key guidance')}>
                    <ul>
                        <li>{l10n.t('PK must exist on every document')}</li>
                        <li>{l10n.t('High-cardinality = better distribution')}</li>
                        <li>{l10n.t('Avoid mutable fields like status')}</li>
                    </ul>
                </InlineGuidance>
                <div className={styles.propertyInputRow}>
                    <div className={styles.tagBox}>
                        {active.properties
                            .filter((p) => !getPartitionKeyRestriction(p, active.properties))
                            .map((p) => (
                                <span key={p.id} className={styles.tag}>
                                    {p.name}
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
                            aria-label={l10n.t('Add property…')}
                            placeholder={l10n.t('Add property…')}
                            value={draftTag}
                            onChange={(e) => setDraftTag(e.target.value)}
                            onKeyDown={onTagKeyDown}
                        />
                    </div>
                    <Button
                        ref={uploadButtonRef}
                        appearance="primary"
                        icon={<ArrowUploadRegular aria-hidden />}
                        aria-description={l10n.t('Upload your JSON documents to infer the schema for this container')}
                        onClick={onUploadClick}
                    >
                        {l10n.t('Upload JSON')}
                    </Button>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="application/json,.json"
                        style={{ display: 'none' }}
                        onChange={(event) => void onFileSelected(event)}
                    />
                </div>
                {uploadContainerId === active.id && uploadInfo ? (
                    <MythBox icon="📄">
                        {l10n.t('Inferred schema from {file}. Review the properties below and edit as needed.', {
                            file: uploadInfo,
                        })}
                    </MythBox>
                ) : null}
                {uploadContainerId === active.id && uploadError ? (
                    <Text className={styles.uploadError} role="alert">
                        {uploadError}
                    </Text>
                ) : null}
                {uploadContainerId === active.id && confirmationError ? (
                    <Text role="alert">{confirmationError}</Text>
                ) : null}

                <div className={styles.tableWrap}>
                    <Table size="small" aria-label={l10n.t('Schema properties')}>
                        <TableHeader>
                            <TableRow>
                                <TableHeaderCell>{l10n.t('Property')}</TableHeaderCell>
                                <TableHeaderCell>{l10n.t('Type')}</TableHeaderCell>
                                <TableHeaderCell>{l10n.t('Role')}</TableHeaderCell>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {active.properties.map((p) => {
                                const restriction = getPartitionKeyRestriction(p, active.properties);
                                const selectedRole = roleOptions.find((option) => option.value === p.role);
                                return (
                                    <TableRow key={p.id}>
                                        <TableCell>{p.name}</TableCell>
                                        <TableCell>
                                            <Select
                                                className={styles.cellSelect}
                                                aria-label={l10n.t('Type for {name}', { name: p.name })}
                                                value={p.type}
                                                onChange={(_, data) =>
                                                    patchProperty(p.id, {
                                                        type: data.value as PropertyType,
                                                        hasNonScalarValues: undefined,
                                                    })
                                                }
                                            >
                                                {PROPERTY_TYPES.map((t) => (
                                                    <option key={t} value={t}>
                                                        {t === 'string (ISO)'
                                                            ? l10n.t('Date/time (ISO 8601 string)')
                                                            : t}
                                                    </option>
                                                ))}
                                            </Select>
                                        </TableCell>
                                        <TableCell>
                                            <div className={styles.roleControls}>
                                                {restriction ? (
                                                    <span className={styles.propertyWarning}>
                                                        <WarningRegular
                                                            className={styles.warningIcon}
                                                            fontSize={16}
                                                            aria-hidden
                                                        />
                                                        <Text size={200}>
                                                            {restriction === 'arrayAncestor'
                                                                ? l10n.t(
                                                                      'Not usable as a partition key: this field is inside an array.',
                                                                  )
                                                                : l10n.t(
                                                                      'Not usable as a partition key: this field has object or array values.',
                                                                  )}
                                                        </Text>
                                                    </span>
                                                ) : (
                                                    <Dropdown
                                                        className={styles.roleDropdown}
                                                        listbox={{ className: styles.roleListbox }}
                                                        positioning={{
                                                            // Overrides the dropdown's default 'width' so the menu can be wider than the control.
                                                            matchTargetSize: undefined,
                                                            autoSize: 'height',
                                                            // Stay below when possible; right-align to the control before flipping above.
                                                            fallbackPositions: [
                                                                'below-end',
                                                                'above-start',
                                                                'above-end',
                                                            ],
                                                        }}
                                                        aria-label={l10n.t('Role for {name}: {role}', {
                                                            name: p.name,
                                                            role: selectedRole?.label ?? p.role,
                                                        })}
                                                        value={selectedRole?.label}
                                                        selectedOptions={[p.role]}
                                                        onOptionSelect={(_, data) => {
                                                            const option = roleOptions.find(
                                                                (option) => option.value === data.optionValue,
                                                            );
                                                            if (option) {
                                                                patchProperty(p.id, { role: option.value });
                                                            }
                                                        }}
                                                    >
                                                        {roleOptions.map((o) => (
                                                            <Option
                                                                key={o.value}
                                                                className={styles.roleOption}
                                                                checkIcon={null}
                                                                value={o.value}
                                                                text={o.label}
                                                                aria-label={o.label}
                                                                aria-description={o.description}
                                                            >
                                                                <span aria-hidden="true">{o.icon}</span>
                                                                <span
                                                                    className={styles.roleOptionHeading}
                                                                    aria-hidden="true"
                                                                >
                                                                    {o.title}
                                                                </span>
                                                                <Text
                                                                    className={styles.roleOptionDescription}
                                                                    size={200}
                                                                    aria-hidden="true"
                                                                >
                                                                    {o.description}
                                                                </Text>
                                                            </Option>
                                                        ))}
                                                    </Dropdown>
                                                )}
                                                <Button
                                                    icon={<DismissRegular />}
                                                    appearance="subtle"
                                                    size="small"
                                                    aria-label={l10n.t('Remove {name}', { name: p.name })}
                                                    onClick={() => removeProperty(p.id)}
                                                />
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            </SubPanel>

            <SubPanel
                title={l10n.t('📐 Document shape & size')}
                subtitle={l10n.t(
                    'RU cost and the 20 GB partition limit scale with document size. The total attributes must match the schema properties table.',
                )}
            >
                <div className={styles.kvGrid}>
                    <Field
                        className={styles.kvField}
                        orientation="horizontal"
                        label={attributeCountLabel}
                        {...fieldValidation(errors.attributeCount)}
                    >
                        <Input
                            className={styles.kvInput}
                            type="number"
                            min={0}
                            max={MAX_ATTRIBUTE_COUNT}
                            step={1}
                            aria-label={attributeCountLabel}
                            name="document.attributeCount"
                            {...numberInput('attributeCount')}
                        />
                    </Field>
                    <Field
                        className={styles.kvField}
                        orientation="horizontal"
                        label={l10n.t('Average document size')}
                        {...fieldValidation(errors.avgSizeKb)}
                    >
                        <div className={styles.unit}>
                            <Input
                                className={styles.kvInput}
                                type="number"
                                min={0}
                                max={MAX_DOCUMENT_SIZE_KB}
                                step="any"
                                aria-label={l10n.t('Average document size')}
                                name="document.avgSizeKb"
                                {...numberInput('avgSizeKb')}
                            />
                            <Text>{'KB'}</Text>
                        </div>
                    </Field>
                    <Field
                        className={styles.kvField}
                        orientation="horizontal"
                        label={l10n.t('Maximum document size')}
                        {...fieldValidation(errors.maxSizeKb)}
                    >
                        <div className={styles.unit}>
                            <Input
                                className={styles.kvInput}
                                type="number"
                                min={0}
                                max={MAX_DOCUMENT_SIZE_KB}
                                step="any"
                                aria-label={l10n.t('Maximum document size')}
                                name="document.maxSizeKb"
                                {...numberInput('maxSizeKb')}
                            />
                            <Text>{'KB'}</Text>
                        </div>
                    </Field>
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
                        <Field
                            className={styles.kvField}
                            orientation="horizontal"
                            label={averageItemsLabel}
                            {...fieldValidation(errors.avgItems)}
                        >
                            <Input
                                className={styles.kvInput}
                                type="number"
                                min={0}
                                max={MAX_ARRAY_ITEMS}
                                step="any"
                                aria-label={averageItemsLabel}
                                name="arrays.avgItems"
                                {...numberInput('avgItems')}
                            />
                        </Field>
                        <Field
                            className={styles.kvField}
                            orientation="horizontal"
                            label={maximumItemsLabel}
                            {...fieldValidation(errors.maxItems)}
                        >
                            <Input
                                className={styles.kvInput}
                                type="number"
                                min={0}
                                max={MAX_ARRAY_ITEMS}
                                step={1}
                                aria-label={maximumItemsLabel}
                                name="arrays.maxItems"
                                {...numberInput('maxItems')}
                            />
                        </Field>
                        <Text>{l10n.t('Array update pattern')}</Text>
                        <Select
                            value={active.arrays.updatePattern}
                            onChange={(_, data) => patchArrays({ updatePattern: data.value as ArrayUpdatePattern })}
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
    );
}
