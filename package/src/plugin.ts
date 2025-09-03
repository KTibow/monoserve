import type { Plugin, ViteDevServer } from "vite";
import { rolldown } from "rolldown";
import { join } from "node:path";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

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
export default async function(arg, init) {
  const res = await fetch(${JSON.stringify(url)}, {
    method: "POST",
    body: stringify(arg),
    ...init,
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
import { parse, stringify } from "devalue";
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
const OUTPUT_OPTIONS = {
  format: "esm",
  minify: "dce-only",
} as const;

export type Options = { monoserverURL: string };
export default ({ monoserverURL }: Options): Plugin => {
  const remoteModules = new Map<string, string>();
  let isBuild = false;

  return {
    name: "vite-plugin-monoserve",
    configResolved(config) {
      isBuild = config.command == "build";
    },
    async transform(code, id) {
      const isRemote = id.endsWith(".remote.ts") || id.endsWith(".remote.js");
      if (!isRemote) return;

      const hash = await getHash(code);
      remoteModules.set(hash, id);

      // Return stub
      const fetchURL = isBuild
        ? `${monoserverURL.replace(/\/$/, "")}/${hash}`
        : `/__monoserve/${hash}`;
      return {
        code: createClient(fetchURL),
      };
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/__monoserve/")) {
          return next();
        }

        const hash = req.url.replace("/__monoserve/", "");
        const id = remoteModules.get(hash);
        if (!id) {
          res.statusCode = 404;
          return res.end("Not found");
        }

        // Build a Request
        const host = req.headers?.host
          ? `http://${req.headers.host}`
          : "http://localhost";
        const url = new URL(req.url || "/", host);

        const method = req.method;

        const headersInit: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers || {})) {
          if (value == undefined) continue;
          headersInit[key] = Array.isArray(value)
            ? value.join(",")
            : String(value);
        }

        let body: Uint8Array | undefined;
        const chunks: Uint8Array[] = [];
        const encoder = new TextEncoder();
        for await (const chunk of req) {
          if (typeof chunk === "string") {
            chunks.push(encoder.encode(chunk));
          } else {
            // In Node, Buffer is a Uint8Array subclass, so this will work.
            // For other environments (like Deno) the chunk will already be a Uint8Array.
            chunks.push(new Uint8Array(chunk));
          }
        }
        if (chunks.length) {
          const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
          const combined = new Uint8Array(totalLength);
          let offset = 0;
          for (const c of chunks) {
            combined.set(c, offset);
            offset += c.length;
          }
          body = combined;
        }

        const request = new Request(url, {
          method,
          headers: headersInit,
          body,
        });

        const tmp = tmpdir();
        const response: Response = await createServer(id)
          .then((bundle) => bundle.generate(OUTPUT_OPTIONS))
          .then((generated) => generated.output[0].code)
          .then(async (code) => {
            const path = join(tmp, `monoserve-${crypto.randomUUID()}.js`);
            await writeFile(path, code);
            const { default: handler } = await import(path);

            const response = await handler(request);

            await rm(path);
            return response;
          });

        res.statusCode = response.status;
        for (const [key, value] of response.headers) {
          res.setHeader(key, value);
        }
        res.end(await response.text());
      });
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
            ...OUTPUT_OPTIONS,
          });
        }),
      );
    },
  };
};
