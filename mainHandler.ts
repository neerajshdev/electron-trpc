import type { AnyRouter } from "@trpc/server";
import { ipcMain } from "electron";

// windowId → subscriptionId → unsubscribe()
const subs = new Map<number, Map<string, () => void>>();

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
        const caller = router.createCaller(event, {});
        const { path, input } = arg;
        let parsedInput = undefined;
        if (input) {
            parsedInput = JSON.parse(input);
        }

        // @ts-ignore
        const result = caller[path](parsedInput);
        return await serializeData(result);
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
