import type { Plugin } from "vite";
import { rolldown } from "rolldown";
import { join } from "node:path";
import { mkdir, readdir, rm } from "node:fs/promises";

const getHash = async (input: string) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex;
};
const createClient = (url: string) =>
  `
import { stringify, parse } from "devalue";
export default async function(arg) {
  const res = await fetch(${JSON.stringify(url)}, {
    method: "POST",
    body: stringify(arg),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return parse(await res.text());
}
`.trimStart();
const bundle = async (js: string) =>
  rolldown({
    // Uses virtual modules
    input: "entry",
    plugins: [
      {
        name: "virtual",
        resolveId(id) {
          if (id == "entry") return id;
        },
        load(id) {
          if (id == "entry") return js;
        },
      },
    ],
  });
const createServer = (path: string) =>
  bundle(
    `
import fn from "${path}";
export default async (req) => {
  if (req.method != "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const arg = await req.text().then(t => parse(t));
  try {
    const result = await fn(arg);
    return new Response(stringify(result), { status: 200 });
  } catch (e) {
    return new Response(e.message || "Error", { status: 500 });
  }
}
`.trimStart(),
  );

export type Options = { monoserverURL: string };
export default ({ monoserverURL }: Options): Plugin => {
  const remoteModules = new Map<string, string>();
  let isBuild = false;

  return {
    name: "vite-plugin-monoserve",
    configResolved(config) {
      isBuild = config.command == "build";
    },
    async transform(_code, id) {
      const isRemote = id.endsWith(".remote.ts") || id.endsWith(".remote.js");
      if (!isRemote) return;

      const hash = await getHash(id);
      remoteModules.set(hash, id);

      // Return stub
      const fetchURL = isBuild
        ? `${monoserverURL.replace(/\/$/, "")}/${hash}`
        : `/__monoserve/${hash}`;
      return {
        code: createClient(fetchURL),
      };
    },
    async closeBundle() {
      if (!isBuild) return;

      const functionsDir = join(process.cwd(), "functions");
      try {
        const files = await readdir(functionsDir);
        await Promise.all(files.map((file) => rm(join(functionsDir, file))));
      } catch (e) {
        await mkdir(functionsDir, { recursive: true });
      }

      await Promise.all(
        Array.from(remoteModules.entries()).map(async ([hash, id]) => {
          const bundle = await createServer(id);
          await bundle.write({
            file: `${functionsDir}/${hash}.js`,
            format: "esm",
          });
        }),
      );
    },
  };
};
