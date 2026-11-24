/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { initWebviewTrpc, type BaseRouterContext, TypedEventSink } from '@microsoft/vscode-ext-webview';
import { attachTrpc } from '@microsoft/vscode-ext-webview/host';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { z } from 'zod';
import {
    getManagedEmulator,
    readManagedEmulator,
    refreshManagedEmulatorTree,
    revealManagedEmulator,
} from '../services/managedEmulator/managedEmulatorExtension';
import {
    containerEngines,
    describeEmulatorError,
    EmulatorError,
    type ContainerEngine,
    type SetupProgress,
} from '../services/managedEmulator/model';
import { BaseTab } from './BaseTab';

const engines = z.enum(containerEngines);
const configuration = z.object({
    engine: engines,
    ports: z.object({ endpoint: z.number().int(), explorer: z.number().int() }),
});

type EmulatorSetupContext = BaseRouterContext & { tab: EmulatorSetupTab };
const trpc = initWebviewTrpc<EmulatorSetupContext>();
const router = trpc.router({
    status: trpc.publicProcedure.query(() => readManagedEmulator()),
    engines: trpc.publicProcedure.query(async (): Promise<{ engines?: ContainerEngine[]; error?: string }> => {
        try {
            return { engines: (await getManagedEmulator()?.availableEngines()) ?? [] };
        } catch (error) {
            return { error: describeEmulatorError(error) };
        }
    }),
    setup: trpc.publicProcedure.input(configuration).mutation(({ ctx, input }) => ctx.tab.run(input)),
    waitLonger: trpc.publicProcedure.mutation(({ ctx }) => ctx.tab.run()),
    cancel: trpc.publicProcedure.mutation(({ ctx }) => {
        ctx.tab.cancel();
    }),
    checkProgress: trpc.publicProcedure.subscription(async function* ({ ctx }) {
        for await (const event of ctx.tab.progress) {
            if (ctx.signal?.aborted) return;
            yield event;
        }
    }),
    openConnection: trpc.publicProcedure.mutation(async (): Promise<{ error?: string }> => {
        try {
            const { instance } = await readManagedEmulator();
            if (instance?.status !== 'running') throw new EmulatorError('readiness');
            await revealManagedEmulator(instance.id);
            return {};
        } catch (error) {
            return { error: describeEmulatorError(error) };
        }
    }),
});

export type EmulatorSetupRouter = typeof router;

export class EmulatorSetupTab extends BaseTab {
    public static readonly viewType = 'cosmosDbEmulatorSetup';
    private static current?: EmulatorSetupTab;
    private operation?: AbortController;
    public readonly progress = new TypedEventSink<SetupProgress & { type: 'progress' }>();

    private constructor(panel: vscode.WebviewPanel) {
        super(panel, EmulatorSetupTab.viewType);
        const context: EmulatorSetupContext = { tab: this };
        const { disposable } = attachTrpc(panel, context, router, trpc.createCallerFactory);
        this.disposables.push(disposable);
    }

    public static open(): void {
        if (this.current && !this.current.isDisposed) {
            this.current.panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            this.viewType,
            l10n.t('Set up Azure Cosmos DB Emulator'),
            vscode.ViewColumn.Active,
            { enableScripts: true, retainContextWhenHidden: true },
        );
        this.current = new EmulatorSetupTab(panel);
    }

    public async run(config?: z.infer<typeof configuration>): Promise<{ error?: string; waiting?: boolean }> {
        if (this.operation) return { error: describeEmulatorError(new EmulatorError('busy')) };
        const operation = new AbortController();
        this.operation = operation;
        try {
            const service = getManagedEmulator();
            if (!service) throw new EmulatorError('storage');
            const report = (event: SetupProgress) => this.progress.emit({ type: 'progress', ...event });
            if (config) {
                await service.provision(config.engine, config.ports, operation.signal, report);
            } else {
                const instance = await service.reconcile();
                if (instance?.status !== 'waiting') throw new EmulatorError('missing');
                await service.act(instance.id, 'reconnect', operation.signal, report);
            }
            return {};
        } catch (error) {
            const waiting =
                (error instanceof EmulatorError && error.problem === 'readiness') ||
                (!config && (await readManagedEmulator()).instance?.status === 'waiting');
            return {
                error: describeEmulatorError(error),
                waiting,
            };
        } finally {
            this.operation = undefined;
            refreshManagedEmulatorTree();
        }
    }

    public cancel(): void {
        this.operation?.abort();
    }

    public override dispose(): void {
        this.cancel();
        this.progress.close();
        super.dispose();
        if (EmulatorSetupTab.current === this) EmulatorSetupTab.current = undefined;
    }
}
