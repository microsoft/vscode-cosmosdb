import { type JSONSchema } from '../JSONSchema';
import { updateSchemaWithDocument } from './SchemaAnalyzer';
import {
    arraysWithDifferentDataTypes,
    complexDocument,
    complexDocumentsArray,
    embeddedDocumentOnly,
    flatDocument,
    sparseDocumentsArray,
} from './mongoTestDocuments';

describe('Mongo Schema Analyzer', () => {
    it('prints out schema for testing', () => {
        const schema: JSONSchema = {};
        updateSchemaWithDocument(schema, embeddedDocumentOnly);
        console.log(JSON.stringify(schema, null, 2));
        expect(schema).toBeDefined();
    });

    it('supports many documents', () => {
        const schema: JSONSchema = {};
        sparseDocumentsArray.forEach((doc) => updateSchemaWithDocument(schema, doc));
        expect(schema).toBeDefined();

        // Check that 'x-documentsInspected' is correct
        expect(schema['x-documentsInspected']).toBe(sparseDocumentsArray.length);

        // Check that the schema has the correct root properties
        const expectedRootProperties = new Set(['_id', 'name', 'age', 'email', 'isActive', 'score', 'description']);

        expect(Object.keys(schema.properties || {})).toEqual(
            expect.arrayContaining(Array.from(expectedRootProperties)),
        );

        // Check that the 'name' field is detected correctly
        const nameField = schema.properties?.['name'];
        expect(nameField).toBeDefined();
        expect(nameField?.['x-occurrence']).toBeGreaterThan(0);

        // Access 'anyOf' to get the type entries
        const nameFieldTypes = nameField.anyOf?.map((typeEntry) => typeEntry['type']);
        expect(nameFieldTypes).toContain('string');

        // Check that the 'age' field has the correct type
        const ageField = schema.properties?.['age'];
        expect(ageField).toBeDefined();
        const ageFieldTypes = ageField.anyOf?.map((typeEntry) => typeEntry['type']);
        expect(ageFieldTypes).toContain('number');

        // Check that the 'isActive' field is a boolean
        const isActiveField = schema.properties?.['isActive'];
        expect(isActiveField).toBeDefined();
        const isActiveTypes = isActiveField.anyOf?.map((typeEntry) => typeEntry['type']);
        expect(isActiveTypes).toContain('boolean');

        // Check that the 'description' field is optional (occurs in some documents)
        const descriptionField = schema.properties?.['description'];
        expect(descriptionField).toBeDefined();
        expect(descriptionField?.['x-occurrence']).toBeLessThan(sparseDocumentsArray.length);
    });

    it('detects all BSON types from flatDocument', () => {
        const schema: JSONSchema = {};
        updateSchemaWithDocument(schema, flatDocument);

        // Check that all fields are detected
        const expectedFields = Object.keys(flatDocument);
        expect(Object.keys(schema.properties || {})).toEqual(expect.arrayContaining(expectedFields));

        // Helper function to get the 'x-bsonType' from a field
        function getBsonType(fieldName: string): string | undefined {
            const field = schema.properties?.[fieldName];
            const anyOf = field?.anyOf;
            return anyOf && anyOf[0]?.['x-bsonType'];
        }

        // Check that specific BSON types are correctly identified
        expect(getBsonType('int32Field')).toBe('int32');
        expect(getBsonType('doubleField')).toBe('double');
        expect(getBsonType('decimalField')).toBe('decimal128');
        expect(getBsonType('dateField')).toBe('date');
        expect(getBsonType('objectIdField')).toBe('objectid');
        expect(getBsonType('codeField')).toBe('code');
    });

    it('detects embedded objects correctly', () => {
        const schema: JSONSchema = {};
        updateSchemaWithDocument(schema, embeddedDocumentOnly);

        // Check that the root properties are detected
        expect(schema.properties).toHaveProperty('personalInfo');
        expect(schema.properties).toHaveProperty('jobInfo');

        // Access 'personalInfo' properties
        const personalInfoAnyOf = schema.properties && schema.properties['personalInfo']?.anyOf;
        const personalInfoProperties = personalInfoAnyOf?.[0]?.properties;
        expect(personalInfoProperties).toBeDefined();
        expect(personalInfoProperties).toHaveProperty('name');
        expect(personalInfoProperties).toHaveProperty('age');
        expect(personalInfoProperties).toHaveProperty('married');
        expect(personalInfoProperties).toHaveProperty('address');

        // Access 'address' properties within 'personalInfo'
        const addressAnyOf = personalInfoProperties['address'].anyOf;
        const addressProperties = addressAnyOf?.[0]?.properties;
        expect(addressProperties).toBeDefined();
        expect(addressProperties).toHaveProperty('street');
        expect(addressProperties).toHaveProperty('city');
        expect(addressProperties).toHaveProperty('zip');
    });

    it('detects arrays and their element types correctly', () => {
        const schema: JSONSchema = {};
        updateSchemaWithDocument(schema, arraysWithDifferentDataTypes);

        // Check that arrays are detected
        expect(schema.properties).toHaveProperty('integersArray');
        expect(schema.properties).toHaveProperty('stringsArray');
        expect(schema.properties).toHaveProperty('booleansArray');
        expect(schema.properties).toHaveProperty('mixedArray');
        expect(schema.properties).toHaveProperty('datesArray');

        // Helper function to get item types from an array field
        function getArrayItemTypes(fieldName: string): string[] | undefined {
            const field = schema.properties?.[fieldName];
            const anyOf = field?.anyOf;
            const itemsAnyOf = anyOf?.[0]?.items?.anyOf;
            return itemsAnyOf?.map((typeEntry) => typeEntry['type']);
        }

        // Check that 'integersArray' has elements of type 'number'
        const integerItemTypes = getArrayItemTypes('integersArray');
        expect(integerItemTypes).toContain('number');

        // Check that 'stringsArray' has elements of type 'string'
        const stringItemTypes = getArrayItemTypes('stringsArray');
        expect(stringItemTypes).toContain('string');

        // Check that 'mixedArray' contains multiple types
        const mixedItemTypes = getArrayItemTypes('mixedArray');
        expect(mixedItemTypes).toEqual(expect.arrayContaining(['number', 'string', 'boolean', 'object', 'null']));
    });

    it('handles arrays within objects and objects within arrays', () => {
        const schema: JSONSchema = {};
        updateSchemaWithDocument(schema, complexDocument);

        // Access 'user.profile.hobbies'
        const userProfile = schema.properties && schema.properties['user'].anyOf?.[0]?.properties?.['profile'];
        const hobbies = userProfile?.anyOf?.[0]?.properties?.['hobbies'];
        const hobbiesItemTypes = hobbies?.anyOf?.[0]?.items?.anyOf?.map((typeEntry) => typeEntry['type']);
        expect(hobbiesItemTypes).toContain('string');

        // Access 'user.profile.addresses'
        const addresses = userProfile?.anyOf?.[0]?.properties?.['addresses'];
        const addressItemTypes = addresses?.anyOf?.[0]?.items?.anyOf?.map((typeEntry) => typeEntry['type']);
        expect(addressItemTypes).toContain('object');

        // Check that 'orders' is an array
        const orders = schema.properties && schema.properties['orders'];
        expect(orders).toBeDefined();
        const ordersType = orders.anyOf?.[0]?.type;
        expect(ordersType).toBe('array');

        // Access 'items' within 'orders'
        const orderItems = orders.anyOf?.[0]?.items?.anyOf?.[0]?.properties?.['items'];
        const orderItemsType = orderItems?.anyOf?.[0]?.type;
        expect(orderItemsType).toBe('array');
    });

    it('updates schema correctly when processing multiple documents', () => {
        const schema: JSONSchema = {};
        complexDocumentsArray.forEach((doc) => updateSchemaWithDocument(schema, doc));

        // Check that 'x-documentsInspected' is correct
        expect(schema['x-documentsInspected']).toBe(complexDocumentsArray.length);

        // Check that some fields are present from different documents
        expect(schema.properties).toHaveProperty('stringField');
        expect(schema.properties).toHaveProperty('personalInfo');
        expect(schema.properties).toHaveProperty('integersArray');
        expect(schema.properties).toHaveProperty('user');

        // Check that 'integersArray' has correct min and max values
        const integersArray = schema.properties && schema.properties['integersArray'];
        const integerItemType = integersArray.anyOf?.[0]?.items?.anyOf?.[0];
        expect(integerItemType?.['x-minValue']).toBe(1);
        expect(integerItemType?.['x-maxValue']).toBe(5);

        // Check that 'orders.items.price' is detected as Decimal128
        const orders = schema.properties && schema.properties['orders'];
        const orderItems = orders.anyOf?.[0]?.items?.anyOf?.[0]?.properties?.['items'];
        const priceField = orderItems?.anyOf?.[0]?.items?.anyOf?.[0]?.properties?.['price'];
        const priceFieldType = priceField?.anyOf?.[0];
        expect(priceFieldType?.['x-bsonType']).toBe('decimal128');
    });
});
