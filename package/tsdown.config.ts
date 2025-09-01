import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["./src/plugin.ts", "./src/fn.ts"],
    platform: "neutral",
    dts: true,
  },
]);
