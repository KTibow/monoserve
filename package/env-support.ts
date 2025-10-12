import { readFile, writeFile } from "node:fs/promises";

const index = await readFile("dist/index.d.ts", "utf8");
await writeFile(
  "dist/index.d.ts",
  `/// <reference types="./env.d.ts" />
${index}`,
);
await writeFile("dist/env.d.ts", "");
