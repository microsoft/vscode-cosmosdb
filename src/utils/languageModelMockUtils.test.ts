/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { createMockLanguageModel, languageModelMessagesToText, setMockRoute } from './languageModelMockUtils';

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const item of iterable) {
        out.push(item);
    }
    return out;
}

const userMessages = () => [vscode.LanguageModelChatMessage.User('hi')];

describe('createMockLanguageModel', () => {
    it('streams a string response as one text chunk and a single text part', async () => {
        const model = createMockLanguageModel({ id: 'm', name: 'M', resolveResponse: () => 'hello world' });

        const response = await model.sendRequest(userMessages(), {});

        expect(await collect(response.text)).toEqual(['hello world']);
        const stream = await collect(response.stream);
        expect(stream).toHaveLength(1);
        expect(stream[0]).toBeInstanceOf(vscode.LanguageModelTextPart);
        expect((stream[0] as vscode.LanguageModelTextPart).value).toBe('hello world');
    });

    it('emits tool-call parts and synthesizes a callId when omitted', async () => {
        const model = createMockLanguageModel({
            id: 'm',
            name: 'M',
            resolveResponse: () => [{ type: 'toolCall', name: 'myTool', input: { a: 1 } }],
        });

        const response = await model.sendRequest(userMessages(), {});
        const stream = await collect(response.stream);

        expect(await collect(response.text)).toEqual([]);
        expect(stream).toHaveLength(1);
        expect(stream[0]).toBeInstanceOf(vscode.LanguageModelToolCallPart);
        const call = stream[0] as vscode.LanguageModelToolCallPart;
        expect(call.name).toBe('myTool');
        expect(call.input).toEqual({ a: 1 });
        expect(call.callId).toMatch(/^mock-call-\d+$/);
    });

    it('preserves a provided tool-call id and orders mixed parts', async () => {
        const model = createMockLanguageModel({
            id: 'm',
            name: 'M',
            resolveResponse: () => [
                { type: 'text', value: 'a' },
                { type: 'toolCall', name: 't', callId: 'fixed-id' },
                { type: 'text', value: 'b' },
            ],
        });

        const response = await model.sendRequest(userMessages(), {});
        const stream = await collect(response.stream);

        expect(await collect(response.text)).toEqual(['a', 'b']);
        expect(stream.map((p) => p.constructor.name)).toEqual([
            'LanguageModelTextPart',
            'LanguageModelToolCallPart',
            'LanguageModelTextPart',
        ]);
        expect((stream[1] as vscode.LanguageModelToolCallPart).callId).toBe('fixed-id');
    });

    it('estimates token counts from string length', async () => {
        const model = createMockLanguageModel({ id: 'm', name: 'M', resolveResponse: () => '' });
        expect(await model.countTokens('12345678')).toBe(2); // ceil(8 / 4)
    });
});

describe('setMockRoute', () => {
    it('is sticky: the route persists across requests until changed or cleared', async () => {
        const seen: (string | undefined)[] = [];
        const model = createMockLanguageModel({
            id: 'm',
            name: 'M',
            resolveResponse: ({ route }) => {
                seen.push(route);
                return 'x';
            },
        });

        await model.sendRequest(userMessages(), {}); // no route set yet
        setMockRoute(model, 'r1');
        await model.sendRequest(userMessages(), {});
        await model.sendRequest(userMessages(), {}); // sticky
        setMockRoute(model, 'r2');
        await model.sendRequest(userMessages(), {});
        setMockRoute(model, undefined); // cleared
        await model.sendRequest(userMessages(), {});

        expect(seen).toEqual([undefined, 'r1', 'r1', 'r2', undefined]);
    });

    it('is a no-op on objects without the mock setter (real models)', () => {
        expect(() => setMockRoute({} as unknown as vscode.LanguageModelChat, 'x')).not.toThrow();
    });
});

describe('languageModelMessagesToText', () => {
    it('returns plain string content', () => {
        expect(languageModelMessagesToText([{ content: 'plain' } as unknown as vscode.LanguageModelChatMessage])).toBe(
            'plain',
        );
    });

    it('joins the values of text parts', () => {
        const message = {
            content: [new vscode.LanguageModelTextPart('a'), new vscode.LanguageModelTextPart('b')],
        } as unknown as vscode.LanguageModelChatMessage;
        expect(languageModelMessagesToText([message])).toBe('a\nb');
    });

    it('recurses into nested tool-result content', () => {
        const toolResult = new vscode.LanguageModelToolResultPart('call-1', [
            new vscode.LanguageModelTextPart('nested'),
        ]);
        const message = { content: [toolResult] } as unknown as vscode.LanguageModelChatMessage;
        expect(languageModelMessagesToText([message])).toBe('nested');
    });
});
