/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document } from 'bson';

/**
 * The BufferStats interface is used to represent the statistics of a buffer
 * It contains the number of files and the total size of the buffer
 */
export interface BufferStats {
    fileCount: number;
    totalSize: number;
}

export interface BufferConfig {
    maxFileCount: number;
    maxTotalSize: number;
    maxSingleFileSize: number;
}

export type BufferInsertResult = {
    /** Indicates whether this operation was success. If true, the documentsToProcess would be undefined*/
    success: boolean;
    /** The documents need be processed at once */
    /** It might be caused by a too-large document, or a full buffer */
    documentsToProcess: Array<Document> | undefined;
};

/**
 * Buffer list for a specific (database, collection)
 */
class BufferList {
    private documents: Document[] = [];
    private totalSize = 0;

    constructor(
        private readonly config: BufferConfig,
        private readonly getSize: (doc: Document) => number,
    ) {}

    public tryAddDocument(doc: Document): BufferInsertResult {
        const result: BufferInsertResult = {
            success: false,
            documentsToProcess: undefined,
        };

        const size = this.getSize(doc);

        if (size > this.config.maxSingleFileSize) return { ...result, documentsToProcess: [doc] };
        if (this.documents.length + 1 > this.config.maxFileCount || this.totalSize + size > this.config.maxTotalSize) {
            return { ...result, documentsToProcess: this.flush() };
        }

        this.documents.push(doc);
        this.totalSize += size;
        return { ...result, success: true };
    }

    public flush(): Document[] {
        const flushed = [...this.documents];
        this.documents = [];
        this.totalSize = 0;
        return flushed;
    }

    public getStats(): BufferStats {
        return {
            fileCount: this.documents.length,
            totalSize: this.totalSize,
        };
    }

    public shouldFlush(size: number = 0): boolean {
        return (
            this.documents.length + 1 > this.config.maxFileCount || this.totalSize + size >= this.config.maxTotalSize
        );
    }
}

/**
 * Buffer manager for a single cluster
 */
export class ClusterBufferManager {
    private static readonly defaultConfig: BufferConfig = {
        maxFileCount: 50,
        maxTotalSize: 32 * 1024 * 1024, // 32 MB
        maxSingleFileSize: 16 * 1024 * 1024, // 16 MB
    };

    // Cluster ID is used to identify the cluster
    // It could be used in the futrue to manage multiple cluster level buffers
    private clusterId: string;
    private config: BufferConfig;
    private buffers: Map<string, BufferList> = new Map();

    constructor(
        clusterId: string,
        config: Partial<BufferConfig> = {},
        /**
         * Function to estimate the size of a document
         * By default, it uses JSON.stringify and adds 20% for overhead
         */
        public readonly getSize: (doc?: Document) => number = (doc) =>
            doc ? Buffer.byteLength(JSON.stringify(doc)) * 1.2 : 0,
    ) {
        this.clusterId = clusterId;
        this.config = { ...ClusterBufferManager.defaultConfig, ...config };
    }

    private getKey(database: string, collection: string): string {
        return `${database}.${collection}`;
    }

    /**
     * Get the buffer for a specific (database, collection)
     * If it doesn't exist, create it
     */
    private getOrCreateBuffer(database: string, collection: string): BufferList {
        const key = this.getKey(database, collection);
        if (!this.buffers.has(key)) {
            this.buffers.set(key, new BufferList(this.config, this.getSize));
        }
        return this.buffers.get(key)!;
    }

    /**
     * Try to insert a document
     * If the document is too large or the buffer is full, it will return the documents that need to be processed
     * Note: It is highly recommended to check if flush needed with `shouldFlush` before inserting
     */
    public insert(database: string, collection: string, document: Document): BufferInsertResult {
        const buffer = this.getOrCreateBuffer(database, collection);
        return buffer.tryAddDocument(document);
    }

    /**
     * Get the buffer stats for a specific (database, collection)
     */
    public getBufferStats(database: string, collection: string): BufferStats {
        return this.getOrCreateBuffer(database, collection).getStats();
    }

    /**
     * Flush the buffer for a specific (database, collection)
     * Returns the documents that need to be processed
     */
    public flush(database: string, collection: string): Document[] {
        return this.getOrCreateBuffer(database, collection).flush();
    }

    /**
     * Check if the buffer should be flushed
     * If a valid size is provided, it will be used to check if the buffer should be flushed with the new document
     * If no size is provided, it will check if the buffer is full
     */
    public shouldFlush(database: string, collection: string, size: number = 0): boolean {
        return this.getOrCreateBuffer(database, collection).shouldFlush(size);
    }
}
