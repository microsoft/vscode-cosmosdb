export interface DeferredPromise<ValueType> {
    /**
     The deferred promise.
     */
    readonly promise: Promise<ValueType>;

    /**
     Resolves the promise with a value or the result of another promise.

     @param value - The value to resolve the promise with.
     */
    resolve(this: void, value?: ValueType | PromiseLike<ValueType>): void;

    /**
     Reject the promise with a provided reason or error.

     @param reason - The reason or error to reject the promise with.
     */
    reject(this: void, reason?: unknown): void;
}

export class Deferred<ValueType> implements DeferredPromise<ValueType> {
    private _resolve!: (value?: ValueType | PromiseLike<ValueType>) => void;
    private _reject!: (reason?: unknown) => void;

    public readonly promise = new Promise<ValueType>((resolve, reject) => {
        this._resolve = resolve;
        this._reject = reject;
    });

    resolve(value?: ValueType | PromiseLike<ValueType>): void {
        this._resolve(value);
    }

    reject(reason?: unknown): void {
        this._reject(reason);
    }
}
