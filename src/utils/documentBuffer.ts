/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EJSON } from 'bson';

/**
 * Configuration options for the document buffer
 */
export interface DocumentBufferOptions {
    /**
     * Maximum size of the buffer in bytes before it should be flushed
     */
    maxBufferSizeBytes: number;

    /**
     * Maximum number of documents in the buffer before it should be flushed
     */
    maxDocumentCount: number;

    /**
     * Maximum size of a single document in bytes that can be added to the buffer
     */
    maxSingleDocumentSizeBytes: number;

    /**
     * Function to calculate the size of a document
     */
    calculateDocumentSize: (document: unknown) => number;
}

export interface BufferInsertResult<T> {
    /**
     * Whether the insert operation was successful
     * If true, the documentsToProcess will be undefined
     */
    success: boolean;

    /**
     * Documents that need to be processed immediately if not buffered
     * This could be the current document if it's too large, or
     * the contents of the buffer if it's full and needs to be flushed
     */
    documentsToProcess?: T[] | T;
}

/**
 * Document buffer for a specific database/collection pair.
 * Used for batching document inserts to improve performance.
 */
export class DocumentBuffer<T> {
    private documents: T[] = [];
    private currentSize: number = 0;

    /**
     * Create a new document buffer
     *
     * @param options Configuration options for the buffer
     */
    constructor(private readonly options: DocumentBufferOptions) {}

    /**
     * Calculate the size of a document using the provided size calculation function
     */
    public getSize(document?: T): number {
        if (!document) {
            return 0;
        }
        return this.options.calculateDocumentSize(document);
    }

    /**
     * Check if the buffer should be flushed
     *
     * @param documentSize Size of the document to be added (optional)
     */
    public shouldFlush(documentSize: number = 0): boolean {
        return (
            this.documents.length + 1 > this.options.maxDocumentCount ||
            this.currentSize + documentSize > this.options.maxBufferSizeBytes
        );
    }

    /**
     * Insert a document into the buffer
     * If the document is too large or the buffer is full, it will return the documents that need to be processed
     * Note: It is highly recommended to check if flush needed with `shouldFlush` before inserting
     *
     * @param document The document to insert
     * @returns Result indicating success or documents that need immediate processing
     */
    public insert(document: T): BufferInsertResult<T> {
        if (!document) {
            return { success: false };
        }

        const documentSize = this.getSize(document);

        // If the document is too large to ever fit in the buffer, return it for immediate processing
        if (documentSize > this.options.maxSingleDocumentSizeBytes) {
            return {
                success: false,
                documentsToProcess: document,
            };
        }

        // If adding this document would cause the buffer to overflow, flush first
        if (this.shouldFlush(documentSize)) {
            return {
                success: false,
                documentsToProcess: this.flush(),
            };
        }

        // Add the document to the buffer
        this.documents.push(document);
        this.currentSize += documentSize;

        return { success: true };
    }

    /**
     * Flush all documents from the buffer
     *
     * @returns All documents currently in the buffer
     */
    public flush(): T[] {
        const documents = [...this.documents];
        this.documents = [];
        this.currentSize = 0;

        return documents;
    }

    /**
     * Get statistics about the current buffer state
     */
    public getStats(): { documentCount: number; currentSizeBytes: number } {
        return {
            documentCount: this.documents.length,
            currentSizeBytes: this.currentSize,
        };
    }
}

// Default configuration for MongoDB buffers
const defaultMongoBufferConfig: DocumentBufferOptions = {
    maxBufferSizeBytes: 32 * 1024 * 1024, // 32MB for batch operations
    maxDocumentCount: 50,
    maxSingleDocumentSizeBytes: 16 * 1024 * 1024, // 16MB (MongoDB document size limit)
    calculateDocumentSize: (document: unknown) => {
        // Use EJSON to calculate the size of MongoDB documents
        // Adding 20% for BSON overhead compared to JSON
        return document ? Buffer.byteLength(EJSON.stringify(document)) * 1.2 : 0;
    },
};

// Default configuration for Cosmos DB buffers
const defaultCosmosBufferConfig: DocumentBufferOptions = {
    maxBufferSizeBytes: 4 * 1024 * 1024, // 4MB total buffer size
    maxDocumentCount: 30, // Cosmos DB has higher latency, so use smaller batches
    maxSingleDocumentSizeBytes: 2 * 1024 * 1024, // 2MB (Cosmos DB document size limit)
    calculateDocumentSize: (document: unknown) => {
        return document ? Buffer.byteLength(EJSON.stringify(document)) * 1.2 : 0;
    },
};

/**
 * Create a document buffer configured for MongoDB
 */
export function createMongoDbBuffer<T>(customConfig?: DocumentBufferOptions): DocumentBuffer<T> {
    return new DocumentBuffer<T>({
        ...defaultMongoBufferConfig,
        ...customConfig,
    });
}

/**
 * Create a document buffer configured for Cosmos DB
 */
export function createCosmosDbBuffer<T>(customConfig?: DocumentBufferOptions): DocumentBuffer<T> {
    return new DocumentBuffer<T>({
        ...defaultCosmosBufferConfig,
        ...customConfig,
    });
}
