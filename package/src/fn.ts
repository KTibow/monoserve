import type { StandardSchemaV1 } from "@standard-schema/spec";

type MaybePromise<T> = T | Promise<T>;
type InferInput<S> = S extends StandardSchemaV1<infer I, any> ? I : never;
type InferParsed<S> = S extends StandardSchemaV1<any, infer P> ? P : never;

// Overload 1: no arg
function fn<O>(
  inner: () => MaybePromise<O>,
): (arg?: never, init?: RequestInit) => Promise<O>;

// Overload 2: arg
function fn<S extends StandardSchemaV1, O>(
  schema: S,
  inner: (arg: InferParsed<S>) => MaybePromise<O>,
): (arg: InferInput<S>, init?: RequestInit) => Promise<O>;

function fn(a: any, b?: any) {
  if (b) {
    const schema = a as StandardSchemaV1<any, any>;
    const inner = b as (arg: any) => MaybePromise<any>;
    return async (input: unknown) => {
      const result = await schema["~standard"].validate(input);
      if (result.issues) {
        throw new Error("Invalid input");
      }
      return await inner(result.value);
    };
  } else {
    const inner = a as () => MaybePromise<any>;
    return async () => {
      return await inner();
    };
  }
}

export default fn;
