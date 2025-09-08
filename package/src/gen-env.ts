import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const envPath = join(fileURLToPath(import.meta.url), "..", "env.d.ts");

export const genEnv = async (
  env: NodeJS.ProcessEnv | Record<string, string>,
) => {
  let js = "";
  let envDTS = `declare module "$env/static/private" {\n`;
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Z0-9_]+$/.test(key)) continue;
    js += `export const ${key} = ${JSON.stringify(value)};\n`;
    envDTS += `  export const ${key}: string;\n`;
  }
  envDTS += "}\n";

  await writeFile(envPath, envDTS);

  return js;
};
