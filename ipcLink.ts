import {type TRPCLink, TRPCClientError} from "@trpc/client";
import type {AnyRouter} from "@trpc/server";
import {observable} from "@trpc/server/observable";

function generateRequestId(): string {
    return crypto.randomUUID();
}

export function ipcLink<TRouter extends AnyRouter>(): TRPCLink<TRouter> {
    return () => {
        return ({ op, next }) => {
            if (op.type !== "query" && op.type !== "mutation") {
                return next(op);
            }

            return observable((observer) => {
                let serializedInput: string | undefined = undefined;
                if (op.input !== undefined) {
                    serializedInput = JSON.stringify(op.input);
                }
                
                const signal = op.signal;
                const requestId = generateRequestId();

                // Listen for abort events from client
                const abortHandler = () => {
                    // Notify main process to abort via IPC
                    // @ts-ignore
                    window.trpc.abort?.({ requestId });
                    observer.error(new TRPCClientError("Request aborted"));
                };
                
                signal?.addEventListener?.('abort', abortHandler);

                // @ts-ignore
                window.trpc
                    .call({
                        requestId,
                        path: op.path,
                        input: serializedInput,
                        type: op.type,
                    })
                    .then((data: any) => {
                        signal?.removeEventListener?.('abort', abortHandler);
                        observer.next({ result: { data: deserializeData(data) } });
                        observer.complete();
                    })
                    .catch((e: any) => {
                        signal?.removeEventListener?.('abort', abortHandler);
                        observer.error(e);
                        observer.complete();
                    });

                return () => {
                    signal?.removeEventListener?.('abort', abortHandler);
                    // Notify main process on cleanup
                    // @ts-ignore
                    window.trpc.abort?.({ requestId });
                };
            });
        };
    };
}

export function ipcSubscriptionLink<
    TRouter extends AnyRouter,
>(): TRPCLink<TRouter> {
    // Map of subscription id -> observer
    const observers = new Map<
        string,
        {
            next: (value: any) => void;
            error: (err: any) => void;
            complete: () => void;
        }
    >();

    let dispatcherRegistered = false;

    const ensureDispatcherRegistered = () => {
        if (dispatcherRegistered) return;

        // @ts-ignore
        window.trpcSub.onData?.(({ id, data }: { id: string; data: any }) => {
            const observer = observers.get(id);
            if (!observer) return;

            try {
                observer.next({
                    result: { data: deserializeData(data) },
                });
            } catch (e) {
                console.error("Error in subscription onData dispatcher:", e);
            }
        });

        // @ts-ignore
        window.trpcSub.onError?.(
            ({ id, error }: { id: string; error: any }) => {
                const observer = observers.get(id);
                if (!observer) return;

                observers.delete(id);
                observer.error(
                    new TRPCClientError("Subscription error", { cause: error }),
                );
            },
        );

        // @ts-ignore
        window.trpcSub.onComplete?.(({ id }: { id: string }) => {
            const observer = observers.get(id);
            if (!observer) return;

            observers.delete(id);
            observer.complete();
        });

        dispatcherRegistered = true;
    };

    return () => {
        return ({ op, next }) => {
            if (op.type !== "subscription") {
                return next(op);
            }

            const id = String(op.id ?? "");

            return observable((observer) => {
                ensureDispatcherRegistered();

                observers.set(id, {
                    next: (value) => observer.next(value),
                    error: (err) => observer.error(err),
                    complete: () => observer.complete(),
                });

                // 1️⃣ Start subscription
                try {
                    // @ts-ignore
                    window.trpcSub.start({
                        id,
                        path: op.path,
                        input: op.input ? JSON.stringify(op.input) : undefined,
                    });
                } catch (e) {
                    observers.delete(id);
                    throw e;
                }

                // 2️⃣ Cleanup
                return () => {
                    observers.delete(id);
                    try {
                        // @ts-ignore
                        window.trpcSub.stop({ id });
                    } catch (e) {
                        console.error("Error stopping subscription:", e);
                    }
                };
            });
        };
    };
}


function deserializeData(data: any): any { 
    if (data === null || data === undefined) {
        return data;
    } else { 
        return JSON.parse(data);
    }
}
