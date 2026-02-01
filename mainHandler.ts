import type {AnyRouter} from "@trpc/server";
import {ipcMain} from "electron";

// windowId → subscriptionId → unsubscribe()
const subs = new Map<number, Map<string, () => void>>();

// requestId → abort controller
const abortControllers = new Map<string, AbortController>();

async function serializeData(result: any): Promise<string | undefined> {
    if (result === undefined) {
        return undefined;
    } else if (result instanceof Promise) {
        const awaitedResult = await result;
        return JSON.stringify(awaitedResult);
    } else {
        return JSON.stringify(result);
    }
}

export function registerTrpcHandler<TAppRouter extends AnyRouter>(router: TAppRouter) {
    ipcMain.handle("trpc", async (event, arg) => {
        const { requestId, path, input } = arg;
        
        // Create abort controller for this request
        const abortController = new AbortController();
        if (requestId) {
            abortControllers.set(requestId, abortController);
        }
        
        // Create context with signal for procedures to access
        const ctx = {
            signal: abortController.signal,
            event
        };
        
        const caller = router.createCaller(ctx);
        let parsedInput = undefined;
        if (input) {
            parsedInput = JSON.parse(input);
        }

        // Check abort before calling
        if (abortController.signal.aborted) {
            throw new DOMException('Aborted', 'ABORT_ERR');
        }

        // @ts-ignore
        const result = caller[path](parsedInput);
        
        // Handle promise-based result with abort checking
        if (result instanceof Promise) {
            const awaitResult = await result;
            
            // Check after completion
            if (abortController.signal.aborted) {
                throw new DOMException('Aborted', 'ABORT_ERR');
            }
            
            return await serializeData(awaitResult);
        }
        
        return await serializeData(result);
    });

    // Handle abort requests
    ipcMain.on("trpc:abort", (_event, { requestId }) => {
        const controller = abortControllers.get(requestId);
        if (controller) {
            controller.abort();
            abortControllers.delete(requestId);
        }
    });

    console.log("Registered IPC handler for tRPC");
}

export function registerTrpcSubscriptionHandler<TAppRouter extends AnyRouter>(router: TAppRouter) {
    ipcMain.on("trpc:sub:start", async (event, payload) => {
        const { id, path, input } = payload;

        let parsedInput = undefined;
        if (input) {
            parsedInput = JSON.parse(input);
        }

        const webContents = event.sender;
        if (!webContents) {
            return;
        }

        const caller = router.createCaller(event, {});

        // @ts-ignore
        const observable = await caller[path](parsedInput);
        console.log("Starting subscription ", id, path, parsedInput);

        const subscription = observable.subscribe({
            // @ts-ignore
            async next(data) {
                webContents.send("trpc:sub:data", {
                    id,
                    data: await serializeData(data),
                });
            },
            // @ts-ignore
            error(error) {
                webContents.send("trpc:sub:error", {
                    id,
                    error: error.message,
                });
            },
            complete() {
                webContents.send("trpc:sub:complete", { id });
            },
        });

        let winSubs = subs.get(webContents.id);
        if (!winSubs) {
            winSubs = new Map();
            subs.set(webContents.id, winSubs);
        }

        winSubs.set(id, () => subscription.unsubscribe());
    });

    ipcMain.on("trpc:sub:stop", (event, { id }) => {
        console.log("Received subscription stop: ", id);

        const webContents = event.sender;
        if (!webContents) return;

        subs.get(webContents.id)?.get(id)?.();
        subs.get(webContents.id)?.delete(id);
    });
}
