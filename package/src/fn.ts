import type { StandardSchemaV1 } from "@standard-schema/spec";

function fn<I, O>(
  fn: (arg: I) => Promise<O>,
  schema?: StandardSchemaV1<I>,
): (arg: I) => Promise<O>;
function fn<I, O>(
  schema: StandardSchemaV1<I>,
  fn: (arg: I) => Promise<O>,
): (arg: I) => Promise<O>;
function fn(a: any, b?: any) {
  const [fn, schema] = typeof a == "function" ? [a, b] : [b, a];
  return async (arg: any) => {
    if (schema) {
      const result = await schema["~standard"].validate(arg);
      if (result.issues) throw new Error("Invalid input");
      arg = result.value;
    }
    return fn(arg);
  };
}

export default fn;
