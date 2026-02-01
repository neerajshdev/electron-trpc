import {contextBridge, ipcRenderer} from "electron";

export function exposeTrpc() {
    contextBridge.exposeInMainWorld("trpc", {
        call: async (req: any) => {
            return await ipcRenderer.invoke("trpc", req);
        },
        abort: (payload: any) => {
            ipcRenderer.send("trpc:abort", payload);
        }
    });
}


export function exposeTrpcSub() {
    // Maintain a single IPC listener per channel and fan out to subscribers.
    const dataCallbacks = new Set<(payload: any) => void>();
    const errorCallbacks = new Set<(payload: any) => void>();
    const completeCallbacks = new Set<(payload: any) => void>();

    ipcRenderer.on('trpc:sub:data', (_event, payload) => {
        for (const cb of dataCallbacks) {
            try {
                cb(payload);
            } catch (e) {
                console.error('Error in trpc:sub:data callback', e);
            }
        }
    });

    ipcRenderer.on('trpc:sub:error', (_event, payload) => {
        for (const cb of errorCallbacks) {
            try {
                cb(payload);
            } catch (e) {
                console.error('Error in trpc:sub:error callback', e);
            }
        }
    });

    ipcRenderer.on('trpc:sub:complete', (_event, payload) => {
        for (const cb of completeCallbacks) {
            try {
                cb(payload);
            } catch (e) {
                console.error('Error in trpc:sub:complete callback', e);
            }
        }
    });

    contextBridge.exposeInMainWorld('trpcSub', {
        start: (payload: any) => ipcRenderer.send('trpc:sub:start', payload),
        stop: (payload: any) => ipcRenderer.send('trpc:sub:stop', payload),

        onData: (cb: (payload: any) => void) => {
            dataCallbacks.add(cb);
        },

        offData: (cb: (payload: any) => void) => {
            dataCallbacks.delete(cb);
        },

        onError: (cb: (payload: any) => void) => {
            errorCallbacks.add(cb);
        },

        offError: (cb: (payload: any) => void) => {
            errorCallbacks.delete(cb);
        },

        onComplete: (cb: (payload: any) => void) => {
            completeCallbacks.add(cb);
        },

        offComplete: (cb: (payload: any) => void) => {
            completeCallbacks.delete(cb);
        },
    });
}
