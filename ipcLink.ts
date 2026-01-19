import { type TRPCLink, TRPCClientError } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";

export function ipcLink<TRouter extends AnyRouter>(): TRPCLink<TRouter> {
    return () => {
        return ({ op, next }) => {
            if (op.type !== "query" && op.type !== "mutation") {
                return next(op);
            }

            return observable((observer) => {
                // @ts-ignore
                window.trpc
                    .call({
                        path: op.path,
                        input: op.input,
                        type: op.type,
                    })
                    .then((data: any) => {
                        observer.next({ result: { data: data } });
                        observer.complete();
                    })
                    .catch((e: any) => {
                        observer.error(e);
                        observer.complete();
                    });
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
                    result: { data },
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
                        input: op.input,
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
