/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition, type PartitionKeyDefinition, PartitionKeyDefinitionVersion } from '@azure/cosmos';
import { arePartitionKeysEqual, extractPartitionKey, extractPartitionKeyValues } from './document';

describe('extractPartitionKey', () => {
    describe('Simple partition key', () => {
        const partitionKeyDef: PartitionKeyDefinition = {
            paths: ['/Country'],
            version: PartitionKeyDefinitionVersion.V2,
        };

        it('should extract a string partition key', () => {
            const document: ItemDefinition = {
                id: '123',
                Country: 'USA',
            };

            const result = extractPartitionKey(document, partitionKeyDef);

            expect(result).toEqual(['USA']);
        });

        it('should extract a number partition key', () => {
            const partitionKeyDef: PartitionKeyDefinition = {
                paths: ['/year'],
                version: PartitionKeyDefinitionVersion.V2,
            };
            const document: ItemDefinition = {
                id: '123',
                year: 2024,
            };

            const result = extractPartitionKey(document, partitionKeyDef);

            expect(result).toEqual([2024]);
        });

        it('should extract a boolean partition key', () => {
            const partitionKeyDef: PartitionKeyDefinition = {
                paths: ['/active'],
                version: PartitionKeyDefinitionVersion.V2,
            };
            const document: ItemDefinition = {
                id: '123',
                active: true,
            };

            const result = extractPartitionKey(document, partitionKeyDef);

            expect(result).toEqual([true]);
        });

        it('should return {} (None type) for missing property', () => {
            const document: ItemDefinition = {
                id: '123',
                City: 'Seattle',
            };

            const result = extractPartitionKey(document, partitionKeyDef);

            expect(result).toEqual([{}]);
        });

        it('should extract null value', () => {
            const document: ItemDefinition = {
                id: '123',
                Country: null,
            };

            const result = extractPartitionKey(document, partitionKeyDef);

            expect(result).toEqual([null]);
        });
    });

    describe('Nested partition key', () => {
        it('should extract nested property', () => {
            const partitionKeyDef: PartitionKeyDefinition = {
                paths: ['/address/zipCode'],
                version: PartitionKeyDefinitionVersion.V2,
            };
            const document: ItemDefinition = {
                id: '123',
                address: {
                    zipCode: '98101',
                    city: 'Seattle',
                },
            };

            const result = extractPartitionKey(document, partitionKeyDef);

            expect(result).toEqual(['98101']);
        });

        it('should return {} (None type) for missing nested property', () => {
            const partitionKeyDef: PartitionKeyDefinition = {
                paths: ['/address/zipCode'],
                version: PartitionKeyDefinitionVersion.V2,
            };
            const document: ItemDefinition = {
                id: '123',
                address: {
                    city: 'Seattle',
                },
            };

            const result = extractPartitionKey(document, partitionKeyDef);

            expect(result).toEqual([{}]);
        });

        it('should return {} (None type) when parent object is missing', () => {
            const partitionKeyDef: PartitionKeyDefinition = {
                paths: ['/address/zipCode'],
                version: PartitionKeyDefinitionVersion.V2,
            };
            const document: ItemDefinition = {
                id: '123',
            };

            const result = extractPartitionKey(document, partitionKeyDef);

            expect(result).toEqual([{}]);
        });

        it('should handle deeply nested properties', () => {
            const partitionKeyDef: PartitionKeyDefinition = {
                paths: ['/user/profile/settings/theme'],
                version: PartitionKeyDefinitionVersion.V2,
            };
            const document: ItemDefinition = {
                id: '123',
                user: {
                    profile: {
                        settings: {
                            theme: 'dark',
                        },
                    },
                },
            };

            const result = extractPartitionKey(document, partitionKeyDef);

            expect(result).toEqual(['dark']);
        });
    });

    describe('Hierarchical partition key (multiple paths)', () => {
        it('should extract multiple partition key values', () => {
            const partitionKeyDef: PartitionKeyDefinition = {
                paths: ['/TenantId', '/UserId', '/SessionId'],
                version: PartitionKeyDefinitionVersion.V2,
            };
            const document: ItemDefinition = {
                id: 'f7da01b0-090b-41d2-8416-dacae09fbb4a',
                TenantId: 'Microsoft',
                UserId: '00aa00aa-bb11-cc22-dd33-44ee44ee44ee',
                SessionId: '0000-11-0000-1111',
            };

            const result = extractPartitionKey(document, partitionKeyDef);

            expect(result).toEqual(['Microsoft', '00aa00aa-bb11-cc22-dd33-44ee44ee44ee', '0000-11-0000-1111']);
        });

        it('should handle mixed types in hierarchical keys', () => {
            const partitionKeyDef: PartitionKeyDefinition = {
                paths: ['/category', '/year', '/active'],
                version: PartitionKeyDefinitionVersion.V2,
            };
            const document: ItemDefinition = {
                id: '123',
                category: 'Electronics',
                year: 2024,
                active: true,
            };

            const result = extractPartitionKey(document, partitionKeyDef);

            expect(result).toEqual(['Electronics', 2024, true]);
        });

        it('should return {} (None type) for missing values in hierarchical keys', () => {
            const partitionKeyDef: PartitionKeyDefinition = {
                paths: ['/TenantId', '/UserId', '/SessionId'],
                version: PartitionKeyDefinitionVersion.V2,
            };
            const document: ItemDefinition = {
                id: 'f7da01b0-090b-41d2-8416-dacae09fbb4a',
                TenantId: 'Microsoft',
                // UserId missing
                SessionId: '0000-11-0000-1111',
            };

            const result = extractPartitionKey(document, partitionKeyDef);

            expect(result).toEqual(['Microsoft', {}, '0000-11-0000-1111']);
        });
    });

    describe('Edge cases', () => {
        it('should handle partition key path with leading slash', () => {
            const partitionKeyDef: PartitionKeyDefinition = {
                paths: ['/Country'],
                version: PartitionKeyDefinitionVersion.V2,
            };
            const document: ItemDefinition = {
                id: '123',
                Country: 'Canada',
            };

            const result = extractPartitionKey(document, partitionKeyDef);

            expect(result).toEqual(['Canada']);
        });

        it('should handle partition key path without leading slash', () => {
            const partitionKeyDef: PartitionKeyDefinition = {
                paths: ['Country'],
                version: PartitionKeyDefinitionVersion.V2,
            };
            const document: ItemDefinition = {
                id: '123',
                Country: 'Canada',
            };

            const result = extractPartitionKey(document, partitionKeyDef);

            expect(result).toEqual(['Canada']);
        });

        it('should extract empty string value (empty strings are valid partition keys)', () => {
            const partitionKeyDef: PartitionKeyDefinition = {
                paths: ['/Country'],
                version: PartitionKeyDefinitionVersion.V2,
            };
            const document: ItemDefinition = {
                id: '123',
                Country: '',
            };

            const result = extractPartitionKey(document, partitionKeyDef);

            expect(result).toEqual(['']);
        });

        it('should return {} (None type) for object value (not a primitive)', () => {
            const partitionKeyDef: PartitionKeyDefinition = {
                paths: ['/data'],
                version: PartitionKeyDefinitionVersion.V2,
            };
            const document: ItemDefinition = {
                id: '123',
                data: { nested: 'value' },
            };

            const result = extractPartitionKey(document, partitionKeyDef);

            expect(result).toEqual([{}]);
        });

        it('should return {} (None type) for array value', () => {
            const partitionKeyDef: PartitionKeyDefinition = {
                paths: ['/tags'],
                version: PartitionKeyDefinitionVersion.V2,
            };
            const document: ItemDefinition = {
                id: '123',
                tags: ['tag1', 'tag2'],
            };

            const result = extractPartitionKey(document, partitionKeyDef);

            expect(result).toEqual([{}]);
        });
    });
});

describe('extractPartitionKeyValues', () => {
    it('should extract partition key as key-value object', () => {
        const partitionKeyDef: PartitionKeyDefinition = {
            paths: ['/Country'],
            version: PartitionKeyDefinitionVersion.V2,
        };
        const document: ItemDefinition = {
            id: '123',
            Country: 'USA',
        };

        const result = extractPartitionKeyValues(document, partitionKeyDef);

        expect(result).toEqual({ '/Country': 'USA' });
    });

    it('should handle multiple partition keys', () => {
        const partitionKeyDef: PartitionKeyDefinition = {
            paths: ['/TenantId', '/UserId'],
            version: PartitionKeyDefinitionVersion.V2,
        };
        const document: ItemDefinition = {
            id: '123',
            TenantId: 'Microsoft',
            UserId: 'user123',
        };

        const result = extractPartitionKeyValues(document, partitionKeyDef);

        expect(result).toEqual({
            '/TenantId': 'Microsoft',
            '/UserId': 'user123',
        });
    });

    it('should return empty object when no partition key defined', () => {
        const document: ItemDefinition = {
            id: '123',
            Country: 'USA',
        };

        const result = extractPartitionKeyValues(document, undefined);

        expect(result).toEqual({});
    });

    it('should handle nested partition key paths', () => {
        const partitionKeyDef: PartitionKeyDefinition = {
            paths: ['/TenantId', '/address/zipCode', '/user/profile/name'],
            version: PartitionKeyDefinitionVersion.V2,
        };
        const document: ItemDefinition = {
            id: '123',
            TenantId: 'Microsoft',
            address: {
                zipCode: '98101',
                city: 'Seattle',
            },
            user: {
                profile: {
                    name: 'John Doe',
                },
            },
        };

        const result = extractPartitionKeyValues(document, partitionKeyDef);

        expect(result).toEqual({
            '/TenantId': 'Microsoft',
            '/address/zipCode': '98101',
            '/user/profile/name': 'John Doe',
        });
    });
});

describe('arePartitionKeysEqual', () => {
    it('should return true for identical simple partition keys', () => {
        const pk1 = ['USA'];
        const pk2 = ['USA'];

        expect(arePartitionKeysEqual(pk1, pk2)).toBe(true);
    });

    it('should return false for different simple partition keys', () => {
        const pk1 = ['USA'];
        const pk2 = ['Canada'];

        expect(arePartitionKeysEqual(pk1, pk2)).toBe(false);
    });

    it('should return true for identical hierarchical partition keys', () => {
        const pk1 = ['Microsoft', 'user123', 'session456'];
        const pk2 = ['Microsoft', 'user123', 'session456'];

        expect(arePartitionKeysEqual(pk1, pk2)).toBe(true);
    });

    it('should return false for different hierarchical partition keys', () => {
        const pk1 = ['Microsoft', 'user123', 'session456'];
        const pk2 = ['Microsoft', 'user123', 'session789'];

        expect(arePartitionKeysEqual(pk1, pk2)).toBe(false);
    });

    it('should return true when both are undefined', () => {
        expect(arePartitionKeysEqual(undefined, undefined)).toBe(true);
    });

    it('should return false when one is undefined', () => {
        const pk1 = ['USA'];

        expect(arePartitionKeysEqual(pk1, undefined)).toBe(false);
        expect(arePartitionKeysEqual(undefined, pk1)).toBe(false);
    });

    it('should return true when both are null', () => {
        expect(arePartitionKeysEqual(null, null)).toBe(true);
    });

    it('should return false when one is null', () => {
        const pk1 = ['USA'];

        expect(arePartitionKeysEqual(pk1, null)).toBe(false);
        expect(arePartitionKeysEqual(null, pk1)).toBe(false);
    });

    it('should handle mixed types in partition keys', () => {
        const pk1 = ['Electronics', 2024, true];
        const pk2 = ['Electronics', 2024, true];

        expect(arePartitionKeysEqual(pk1, pk2)).toBe(true);
    });

    it('should return false for different types at same position', () => {
        const pk1 = ['Electronics', 2024];
        const pk2 = ['Electronics', '2024'];

        expect(arePartitionKeysEqual(pk1, pk2)).toBe(false);
    });

    it('should return false for different array lengths', () => {
        const pk1 = ['USA'];
        const pk2 = ['USA', 'Seattle'];

        expect(arePartitionKeysEqual(pk1, pk2)).toBe(false);
    });

    it('should handle null values in partition keys', () => {
        const pk1 = ['USA', null];
        const pk2 = ['USA', null];

        expect(arePartitionKeysEqual(pk1, pk2)).toBe(true);
    });

    it('should return false when null positions differ', () => {
        const pk1 = ['USA', null];
        const pk2 = ['USA', 'Seattle'];

        expect(arePartitionKeysEqual(pk1, pk2)).toBe(false);
    });
});
