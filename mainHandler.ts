import type { AnyRouter } from "@trpc/server";
import { ipcMain } from "electron";

// windowId → subscriptionId → unsubscribe()
const subs = new Map<number, Map<string, () => void>>();

export function registerTrpcHandler<TAppRouter extends AnyRouter>(
    router: TAppRouter,
) {
    const caller = router.createCaller({});

    ipcMain.handle("trpc", async (_event, arg) => {
        const { path, type, input } = arg;

        if (type === "query") {
            // @ts-ignore
            return caller[path](input);
        }

        if (type === "mutation") {
            // @ts-ignore
            return caller[path](input);
        }

        throw new Error(`Unknown tRPC type: ${type}`);
    });

    console.log("Registered IPC handler for tRPC");
}

export function registerTrpcSubscriptionHandler<TAppRouter extends AnyRouter>(
    router: TAppRouter,
) {
    ipcMain.on("trpc:sub:start", async (event, payload) => {
        const { id, path, input } = payload;
        console.log("Received subscription start: ", id, path, input);

        const webContents = event.sender;
        if (!webContents) {
            return;
        }

        const caller = router.createCaller({});

        // @ts-ignore
        const observable = await caller[path](input);
        console.log("Starting subscription ", id, path, input);

        const subscription = observable.subscribe({
            // @ts-ignore
            next(data) {
                webContents.send("trpc:sub:data", { id, data });
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
