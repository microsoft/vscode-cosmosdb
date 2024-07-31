import { WebviewTransport } from '../Transport/WebviewTransport';
import { CommonChannel } from './CommonChannel';

export class WebviewChannel extends CommonChannel {
    constructor() {
        const transport = new WebviewTransport(window);
        super('webview', transport);
    }

    dispose(): void {
        super.dispose();
        this.transport.dispose();
    }
}
