import { fn } from "monoserve";
import { string } from "valibot";

export default fn(string(), (text) => text);
