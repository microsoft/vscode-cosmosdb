/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-unsafe-member-access */

import { Db, FindCursor } from 'mongodb';
import { SchemaConfiguration } from 'vscode-json-languageservice';
// eslint-disable-next-line import/no-internal-modules
import { JSONSchema } from 'vscode-json-languageservice/lib/umd/jsonSchema';

export class SchemaService {

    private _db: Db;
    private _schemasCache: Map<string, string> = new Map<string, string>();

    public registerSchemas(db: Db): Thenable<SchemaConfiguration[]> {
        this._db = db;
        this._schemasCache.clear();
        return this._db.collections()
            .then(collections => {
                const schemas: SchemaConfiguration[] = [];
                for (const collection of collections) {
                    schemas.push(...[{
                        uri: this.queryCollectionSchema(collection.collectionName),
                        fileMatch: [this.queryDocumentUri(collection.collectionName)]
                    }, {
                        uri: this.aggregateCollectionSchema(collection.collectionName),
                        fileMatch: [this.aggregateDocumentUri(collection.collectionName)]
                    }]);
                }
                return schemas;
            });
    }

    public queryCollectionSchema(collectionName: string): string {
        return 'mongo://query/' + collectionName + '.schema';
    }

    public aggregateCollectionSchema(collectionName: string): string {
        return 'mongo://aggregate/' + collectionName + '.schema';
    }

    public queryDocumentUri(collectionName: string): string {
        return 'mongo://query/' + collectionName + '.json';
    }

    public aggregateDocumentUri(collectionName: string): string {
        return 'mongo://aggregate/' + collectionName + '.json';
    }

    public resolveSchema(uri: string): Thenable<string> {
        const schema = this._schemasCache.get(uri);
        if (schema) {
            return Promise.resolve(schema);
        }
        if (uri.startsWith('mongo://query/')) {
            return this._resolveQueryCollectionSchema(uri.substring('mongo://query/'.length, uri.length - '.schema'.length), uri)
                .then(sch => {
                    this._schemasCache.set(uri, sch);
                    return sch;
                });
        }
        if (uri.startsWith('mongo://aggregate/')) {
            return this._resolveAggregateCollectionSchema(uri.substring('mongo://aggregate/'.length, uri.length - '.schema'.length))
                .then(sch => {
                    this._schemasCache.set(uri, sch);
                    return sch;
                });
        }
        return Promise.resolve('');
    }

    private _resolveQueryCollectionSchema(collectionName: string, schemaUri: string): Thenable<string> {
        const collection = this._db.collection(collectionName);
        const cursor = collection.find();
        return new Promise((resolve, _reject) => {
            this.readNext([], cursor, 10, (result) => {
                const schema: JSONSchema = {
                    type: 'object',
                    properties: {}
                };
                for (const document of result) {
                    this.setSchemaForDocument(null!, document, schema);
                }
                this.setGlobalOperatorProperties(schema);
                this.setLogicalOperatorProperties(schema, schemaUri);
                resolve(JSON.stringify(schema));
            });
        });
    }

    private _resolveAggregateCollectionSchema(collectionName: string): Thenable<string> {
        const collection = this._db.collection(collectionName);
        const cursor = collection.find();
        return new Promise((resolve, _reject) => {
            this.readNext([], cursor, 10, (_result) => {
                const schema: JSONSchema = {
                    type: 'array',
                    items: this.getAggregateStagePropertiesSchema(this.queryCollectionSchema(collectionName))
                };
                resolve(JSON.stringify(schema));
            });
        });
    }

    private getMongoDocumentType(document: any): string {
        return Array.isArray(document) ? 'array' : (document === null ? 'null' : typeof document);
    }

    private setSchemaForDocument(parent: string, document: any, schema: JSONSchema): void {
        if (this.getMongoDocumentType(document) === 'object') {
            for (const property of Object.keys(document)) {
                if (!parent &&
                    ['_id'].indexOf(property) !== -1) {
                    continue;
                }
                this.setSchemaForDocumentProperty(parent, property, document, schema);
            }
        }
    }

    private setSchemaForDocumentProperty(parent: string, property: string, document: any, schema: JSONSchema): void {
        const scopedProperty = parent ? `${parent}.${property}` : property;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        const value = document[property];
        const type = this.getMongoDocumentType(value);

        const propertySchema: JSONSchema = {
            type: [type, 'object']
        };
        this.setOperatorProperties(type, propertySchema);
        schema.properties![scopedProperty] = propertySchema;

        if (type === 'object') {
            this.setSchemaForDocument(scopedProperty, value, schema);
        }

        if (type === 'array') {
            for (const v of value) {
                this.setSchemaForDocument(scopedProperty, v, schema);
            }
        }
    }

    private setGlobalOperatorProperties(schema: JSONSchema): void {
        schema.properties!.$text = <JSONSchema>{
            type: 'object',
            description: 'Performs text search',
            properties: {
                $search: <JSONSchema>{
                    type: 'string',
                    description: 'A string of terms that MongoDB parses and uses to query the text index. MongoDB performs a logical OR search of the terms unless specified as a phrase'
                },
                $language: {
                    type: 'string',
                    description: 'Optional. The language that determines the list of stop words for the search and the rules for the stemmer and tokenizer. If not specified, the search uses the default language of the index.\nIf you specify a language value of "none", then the text search uses simple tokenization with no list of stop words and no stemming'
                },
                $caseSensitive: {
                    type: 'boolean',
                    description: 'Optional. A boolean flag to enable or disable case sensitive search. Defaults to false; i.e. the search defers to the case insensitivity of the text index'
                },
                $diacriticSensitive: {
                    type: 'boolean',
                    description: `Optional. A boolean flag to enable or disable diacritic sensitive search against version 3 text indexes.Defaults to false; i.e.the search defers to the diacritic insensitivity of the text index
Text searches against earlier versions of the text index are inherently diacritic sensitive and cannot be diacritic insensitive. As such, the $diacriticSensitive option has no effect with earlier versions of the text index`
                }
            },
            required: ['$search']
        };

        schema.properties!.$where = {
            type: 'string',
            description: `Matches documents that satisfy a JavaScript expression.
Use the $where operator to pass either a string containing a JavaScript expression or a full JavaScript function to the query system`
        };
        schema.properties!.$comment = {
            type: 'string',
            description: 'Adds a comment to a query predicate'
        };
    }

    private setLogicalOperatorProperties(schema: JSONSchema, schemaUri: string): void {
        schema.properties!.$or = {
            type: 'array',
            description: 'Joins query clauses with a logical OR returns all documents that match the conditions of either clause',
            items: <JSONSchema>{
                $ref: schemaUri
            }
        };
        schema.properties!.$and = {
            type: 'array',
            description: 'Joins query clauses with a logical AND returns all documents that match the conditions of both clauses',
            items: <JSONSchema>{
                $ref: schemaUri
            }
        };
        schema.properties!.$nor = {
            type: 'array',
            description: 'Joins query clauses with a logical NOR returns all documents that fail to match both clauses',
            items: <JSONSchema>{
                $ref: schemaUri
            }
        };
    }

    private setOperatorProperties(type: string, schema: JSONSchema): void {
        if (!schema.properties) {
            schema.properties = {};
        }

        const expressionSchema = {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            properties: <any>{}
        };
        // Comparison operators
        expressionSchema.properties.$eq = {
            type: type,
            description: 'Matches values that are equal to a specified value'
        };
        expressionSchema.properties.$gt = {
            type: type,
            description: 'Matches values that are greater than a specified value'
        };
        expressionSchema.properties.$gte = {
            type: type,
            description: 'Matches values that are greater than or equal to a specified value'
        };
        expressionSchema.properties.$lt = {
            type: type,
            description: 'Matches values that are less than a specified value'
        };
        expressionSchema.properties.$lte = {
            type: type,
            description: 'Matches values that are less than or equal to a specified value'
        };
        expressionSchema.properties.$ne = {
            type: type,
            description: 'Matches all values that are not equal to a specified value'
        };
        expressionSchema.properties.$in = {
            type: 'array',
            description: 'Matches any of the values specified in an array'
        };
        expressionSchema.properties.$nin = {
            type: 'array',
            description: 'Matches none of the values specified in an array'
        };

        // Element operators
        expressionSchema.properties.$exists = {
            type: 'boolean',
            description: 'Matches documents that have the specified field'
        };
        expressionSchema.properties.$type = {
            type: 'string',
            description: 'Selects documents if a field is of the specified type'
        };

        // Evaluation operators
        expressionSchema.properties.$mod = {
            type: 'array',
            description: 'Performs a modulo operation on the value of a field and selects documents with a specified result',
            maxItems: 2,
            default: [2, 0]
        };
        expressionSchema.properties.$regex = {
            type: 'string',
            description: 'Selects documents where values match a specified regular expression'
        };

        // Geospatial
        const geometryPropertySchema: JSONSchema = {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    default: 'GeoJSON object type'
                },
                coordinates: {
                    type: 'array'
                },
                crs: {
                    type: 'object',
                    properties: {
                        type: {
                            type: 'string'
                        },
                        properties: {
                            type: 'object'
                        }
                    }
                }
            }
        };
        expressionSchema.properties.$geoWithin = {
            type: 'object',
            description: 'Selects geometries within a bounding GeoJSON geometry. The 2dsphere and 2d indexes support $geoWithin',
            properties: {
                $geometry: geometryPropertySchema,
                $box: {
                    type: 'array'
                },
                $polygon: {
                    type: 'array'
                },
                $center: {
                    type: 'array'
                },
                $centerSphere: {
                    type: 'array'
                }
            }
        };
        expressionSchema.properties.$geoIntersects = {
            type: 'object',
            description: 'Selects geometries that intersect with a GeoJSON geometry. The 2dsphere index supports $geoIntersects',
            properties: {
                $geometry: geometryPropertySchema
            }
        };
        expressionSchema.properties.$near = {
            type: 'object',
            description: 'Returns geospatial objects in proximity to a point. Requires a geospatial index. The 2dsphere and 2d indexes support $near',
            properties: {
                $geometry: geometryPropertySchema,
                $maxDistance: {
                    type: 'number'
                },
                $minDistance: {
                    type: 'number'
                }
            }
        };
        expressionSchema.properties.$nearSphere = {
            type: 'object',
            description: 'Returns geospatial objects in proximity to a point. Requires a geospatial index. The 2dsphere and 2d indexes support $near',
            properties: {
                $geometry: geometryPropertySchema,
                $maxDistance: {
                    type: 'number'
                },
                $minDistance: {
                    type: 'number'
                }
            }
        };

        // Array operatos
        if (type === 'array') {
            expressionSchema.properties.$all = {
                type: 'array',
                description: 'Matches arrays that contain all elements specified in the query'
            };
            expressionSchema.properties.$size = {
                type: 'number',
                description: 'Selects documents if the array field is a specified size'
            };
        }

        // Bit operators
        expressionSchema.properties.$bitsAllSet = {
            type: 'array',
            description: 'Matches numeric or binary values in which a set of bit positions all have a value of 1'
        };
        expressionSchema.properties.$bitsAnySet = {
            type: 'array',
            description: 'Matches numeric or binary values in which any bit from a set of bit positions has a value of 1'
        };
        expressionSchema.properties.$bitsAllClear = {
            type: 'array',
            description: 'Matches numeric or binary values in which a set of bit positions all have a value of 0'
        };
        expressionSchema.properties.$bitsAnyClear = {
            type: 'array',
            description: 'Matches numeric or binary values in which any bit from a set of bit positions has a value of 0'
        };

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        schema.properties = { ...expressionSchema.properties };
        schema.properties!.$not = {
            type: 'object',
            description: 'Inverts the effect of a query expression and returns documents that do not match the query expression',
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            properties: { ...expressionSchema.properties }
        };
        schema.properties!.$elemMatch = {
            type: 'object'
        };
    }

    private getAggregateStagePropertiesSchema(querySchemaUri: string): JSONSchema {
        const schemas: JSONSchema[] = [];
        schemas.push({
            type: 'object',
            properties: {
                $collStats: {
                    type: 'object',
                    description: 'Returns statistics regarding a collection or view'
                }
            }

        });
        schemas.push({
            type: 'object',
            properties: {
                $project: {
                    type: 'object',
                    description: 'Reshapes each document in the stream, such as by adding new fields or removing existing fields. For each input document, outputs one document'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $match: {
                    type: 'object',
                    description: 'Filters the document stream to allow only matching documents to pass unmodified into the next pipeline stage. $match uses standard MongoDB queries. For each input document, outputs either one document (a match) or zero documents (no match)',
                    $ref: querySchemaUri
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $redact: {
                    type: 'object',
                    description: 'Reshapes each document in the stream by restricting the content for each document based on information stored in the documents themselves. Incorporates the functionality of $project and $match. Can be used to implement field level redaction. For each input document, outputs either one or zero documents'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $limit: {
                    type: 'object',
                    description: 'Passes the first n documents unmodified to the pipeline where n is the specified limit. For each input document, outputs either one document (for the first n documents) or zero documents (after the first n documents).'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $skip: {
                    type: 'object',
                    description: 'Skips the first n documents where n is the specified skip number and passes the remaining documents unmodified to the pipeline. For each input document, outputs either zero documents (for the first n documents) or one document (if after the first n documents)'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $unwind: {
                    type: 'object',
                    description: 'Deconstructs an array field from the input documents to output a document for each element. Each output document replaces the array with an element value. For each input document, outputs n documents where n is the number of array elements and can be zero for an empty array'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $group: {
                    type: 'object',
                    description: 'Groups input documents by a specified identifier expression and applies the accumulator expression(s), if specified, to each group. Consumes all input documents and outputs one document per each distinct group. The output documents only contain the identifier field and, if specified, accumulated fields.',
                    properties: {
                        _id: {
                            type: ['string', 'object']
                        }
                    },
                    additionalProperties: {
                        type: 'object'
                    }
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $sample: {
                    type: 'object',
                    description: 'Randomly selects the specified number of documents from its input'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $sort: {
                    type: 'object',
                    description: 'Reorders the document stream by a specified sort key. Only the order changes; the documents remain unmodified. For each input document, outputs one document.'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $geoNear: {
                    type: 'object',
                    description: 'Returns an ordered stream of documents based on the proximity to a geospatial point. Incorporates the functionality of $match, $sort, and $limit for geospatial data. The output documents include an additional distance field and can include a location identifier field.'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $lookup: {
                    type: 'object',
                    description: 'Performs a left outer join to another collection in the same database to filter in documents from the “joined” collection for processing'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $out: {
                    type: 'object',
                    description: 'Writes the resulting documents of the aggregation pipeline to a collection. To use the $out stage, it must be the last stage in the pipeline'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $indexStats: {
                    type: 'object',
                    description: 'Returns statistics regarding the use of each index for the collection'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $facet: {
                    type: 'object',
                    description: 'Processes multiple aggregation pipelines within a single stage on the same set of input documents. Enables the creation of multi-faceted aggregations capable of characterizing data across multiple dimensions, or facets, in a single stage'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $bucket: {
                    type: 'object',
                    description: 'Categorizes incoming documents into groups, called buckets, based on a specified expression and bucket boundaries'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $bucketAuto: {
                    type: 'object',
                    description: 'Categorizes incoming documents into a specific number of groups, called buckets, based on a specified expression. Bucket boundaries are automatically determined in an attempt to evenly distribute the documents into the specified number of buckets'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $sortByCount: {
                    type: 'object',
                    description: 'Groups incoming documents based on the value of a specified expression, then computes the count of documents in each distinct group'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $addFields: {
                    type: 'object',
                    description: 'Adds new fields to documents. Outputs documents that contain all existing fields from the input documents and newly added fields'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $replaceRoot: {
                    type: 'object',
                    description: 'Replaces a document with the specified embedded document. The operation replaces all existing fields in the input document, including the _id field. Specify a document embedded in the input document to promote the embedded document to the top level'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $count: {
                    type: 'object',
                    description: 'Returns a count of the number of documents at this stage of the aggregation pipeline'
                }
            }
        });
        schemas.push({
            type: 'object',
            properties: {
                $graphLookup: {
                    type: 'object',
                    description: 'Performs a recursive search on a collection. To each output document, adds a new array field that contains the traversal results of the recursive search for that document'
                }
            }
        });
        return {
            type: 'object',
            oneOf: schemas
        };
    }

    private readNext(result: any[], cursor: FindCursor<any>, batchSize: number, callback: (result: any[]) => void): void {
        if (result.length === batchSize) {
            callback(result);
            return;
        }

        void cursor.hasNext().then(hasNext => {
            if (!hasNext) {
                callback(result);
                return;
            }

            void cursor.next().then(doc => {
                result.push(doc);
                this.readNext(result, cursor, batchSize, callback);
            });
        });
    }

}
