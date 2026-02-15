import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.d.ts", "./src/plugin.ts", "./src/gen-env-cli.ts"],
  platform: "neutral",
  dts: true,
});
