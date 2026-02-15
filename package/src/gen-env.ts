import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const envPath = join(process.cwd(), "node_modules", "@types", "monoserve-env", "index.d.ts");

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

  await mkdir(dirname(envPath), { recursive: true });
  await writeFile(envPath, envDTS);

  return js;
};
