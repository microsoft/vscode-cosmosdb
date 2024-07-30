import { Transport } from '../Transport/Transport';
import { Channel, ChannelMessage } from './Channel';

export class CommonChannel implements Channel {
    private listeners: Record<string, ((message: ChannelMessage) => void)[]> = {};
    private pendingRequests: Record<string, Promise> = {};
    private readonly handleMessageInternal: (msg: unknown) => void;

    constructor(
        public readonly name: string,
        public readonly transport: Transport,
    ) {
        this.handleMessageInternal = (msg: unknown) => this.handleMessage(msg);
        this.transport.on(this.handleMessage);
    }

    postMessage(message: ChannelMessage): Thenable<boolean> {
        return this.transport.post(message);
    }

    on(event: string, callback: (message: ChannelMessage) => void): Channel {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);

        return this;
    }

    once(event: string, callback: (message: ChannelMessage) => void): Channel {
        const wrappedCallback = (message: ChannelMessage) => {
            callback(message);
            this.off(event, wrappedCallback);
        };

        this.on(event, wrappedCallback);

        return this;
    }

    off(event: string, callback: (message: ChannelMessage) => void): Channel {
        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
        }

        return this;
    }

    dispose(): void {
        this.listeners = {};
        // since the transport is shared, we don't dispose it here
        this.transport.off(this.handleMessageInternal);
    }

    private handleMessage(msg: unknown): void {
        try {
            if (!isChannelMessage(msg)) {
                return;
            }

            const message = msg as Message;
            const listeners = this.listeners[message.type];
            if (!listeners) {
                return;
            }

            listeners.forEach((cb) => cb(message));
        } catch (error) {
            // TODO: Telemetry
            console.error(error);
        }
    }
}
