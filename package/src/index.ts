import type { StandardSchemaV1 } from "@standard-schema/spec";
import { parse, stringify } from "devalue";

type MaybePromise<T> = T | Promise<T>;
type InferInput<S> = S extends StandardSchemaV1<infer I, any> ? I : never;
type InferParsed<S> = S extends StandardSchemaV1<any, infer P> ? P : never;

const wrap =
  (f: (request: Request) => MaybePromise<Response>) => (request: Request) =>
    Promise.resolve(f(request)).catch((err) => {
      console.error(err);
      return new Response("Internal server error", { status: 500 });
    });

// Overload 1: no arg
export function fn<O>(
  inner: () => MaybePromise<O>,
): (arg?: never, init?: RequestInit) => Promise<O>;

// Overload 2: arg
export function fn<S extends StandardSchemaV1, O>(
  schema: S,
  inner: (arg: InferParsed<S>) => MaybePromise<O>,
): (arg: InferInput<S>, init?: RequestInit) => Promise<O>;

export function fn(a: any, b?: any) {
  const wrapExt = (logic: (arg?: unknown) => any) =>
    wrap(async (request: Request) => {
      if (request.method != "POST") {
        return new Response("Method not allowed", { status: 405 });
      }
      const arg = await request.text().then((t) => parse(t));
      const result = await logic(arg);
      const response =
        result instanceof Response
          ? result
          : new Response(stringify(result), {
              headers: { "content-type": "application/json" },
            });
      return response;
    });
  if (b) {
    const schema = a as StandardSchemaV1<any, any>;
    const inner = b as (arg: any) => MaybePromise<any>;
    return wrapExt(async (argUnsafe: unknown) => {
      const arg = await schema["~standard"].validate(argUnsafe);
      if (arg.issues) {
        throw new Error("Invalid input");
      }
      return await inner(arg.value);
    });
  } else {
    const inner = a as () => MaybePromise<any>;
    return wrapExt(inner) as any;
  }
}

type RawClient = (init: RequestInit) => Promise<Response>;
export function fnRaw(inner: (req: Request) => MaybePromise<Response>) {
  return wrap(inner) as unknown as RawClient;
}

type WebSocketClient = () => WebSocket;
export function fnWebSocket(
  inner: (ws: WebSocket, req?: Request) => MaybePromise<void>,
) {
  if (typeof Deno == "undefined") {
    throw new Error("WebSocket not supported in this environment");
  }
  return wrap((req: Request) => {
    if (req.method != "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    if (req.headers.get("upgrade") != "websocket") {
      return new Response("Bad request", { status: 400 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    Promise.resolve(inner(socket, req)).catch((err) => {
      console.error("WebSocket error:", err);
      socket.close(1011, "Internal server error");
    });
    return response;
  }) as unknown as WebSocketClient;
}
