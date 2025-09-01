import fn from "monoserve/fn";
import { type } from "arktype";

export default fn(type("string"), (text) => text);
