import type { StandardSchemaV1 } from "@standard-schema/spec";

type MaybePromise<T> = T | Promise<T>;
type InferInput<S> = S extends StandardSchemaV1<infer I, any> ? I : never;
type InferParsed<S> = S extends StandardSchemaV1<any, infer P> ? P : never;

export function fn<O>(
  inner: () => MaybePromise<O>,
): (init?: RequestInit) => Promise<O>;

export function fn<S extends StandardSchemaV1, O>(
  schema: S,
  inner: (arg: InferParsed<S>) => MaybePromise<O>,
): (arg: InferInput<S>, init?: RequestInit) => Promise<O>;

type WebSocketClient = () => WebSocket;
export function fnWebSocket(
  inner: (ws: WebSocket, req?: Request) => MaybePromise<void>,
): WebSocketClient;
