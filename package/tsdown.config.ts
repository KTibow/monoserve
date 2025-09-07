import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/plugin.ts", "./src/fn.ts", "./src/gen-env-cli.ts"],
  platform: "neutral",
  dts: true,
  plugins: [
    {
      name: "add-ref",
      generateBundle(_options, bundle) {
        for (const fileName of Object.keys(bundle)) {
          if (!fileName.endsWith("fn.d.ts")) continue;

          const file = bundle[fileName];
          if (!("code" in file)) continue;
          file.code = `/// <reference path="./env.d.ts" />\n${file.code}`;
        }
      },
    },
  ],
});
