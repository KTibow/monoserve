import { fn } from "monoserve";
import { type } from "arktype";

export default fn(type("string"), (text) => text);
