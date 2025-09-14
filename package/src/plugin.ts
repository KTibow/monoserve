import { loadEnv, type Connect, type Plugin, type ViteDevServer } from "vite";
import { rolldown, type InputOptions, type OutputOptions } from "rolldown";
import { dirname, join } from "node:path";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { cwd } from "node:process";
import type { ServerResponse } from "node:http";
import { genEnv } from "./gen-env";

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

  const contentType = res.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    return res;
  }
  return parse(await res.text());
}
`.trimStart();
const createRawClient = (url: string) =>
  `
export default async function(init) {
  return await fetch(${JSON.stringify(url)}, {
    method: "POST",
    ...init,
  });
}
`.trimStart();
const createServer = (path: string) =>
  `
import { parse, stringify } from "devalue";
import fn from "${path}";
export default "_raw" in fn
  ? fn
  : async (req) => {
      if (req.method != "POST") {
        return new Response("Method not allowed", { status: 405 });
      }
      const arg = await req.text().then((t) => parse(t));
      try {
        const result = await fn(arg);
        if (result instanceof Response) {
          return result;
        }
        return new Response(stringify(result), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      } catch (e) {
        return new Response(e.message || "Error", { status: 500 });
      }
    };
`.trimStart();
const toRequest = async (req: Connect.IncomingMessage) => {
  const host = req.headers?.host
    ? `http://${req.headers.host}`
    : "http://localhost";
  const url = new URL(req.url || "/", host);

  const method = req.method;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (key.startsWith(":")) continue; // psuedo-headers
    if (value == undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        headers.append(key, v);
      }
    } else {
      headers.set(key, value);
    }
  }

  return new Request(url, {
    method,
    headers,
    body: req, // yeah it's a readable stream
    duplex: "half", // we must do this as Requests were designed to be sent, not received
  });
};
const sendResponse = async (res: ServerResponse, response: Response) => {
  res.statusCode = response.status;
  for (const [key, value] of response.headers) {
    res.setHeader(key, value);
  }
  // Stream the response body back to the client
  const body = response.body;
  if (!body) {
    return res.end();
  }

  for await (const value of body) {
    res.write(value);
  }
  res.end();
};

export type Options = {
  monoserverURL: string;
  tempLocation?: string;
  rolldownInputOptions?: InputOptions;
  rolldownOutputOptions?: OutputOptions;
};
export const monoserve = ({
  monoserverURL,
  tempLocation = tmpdir(),
  rolldownInputOptions,
  rolldownOutputOptions,
}: Options): Plugin => {
  const bundle = async (js: string) =>
    rolldown({
      // Uses virtual modules
      input: "entry",
      plugins: [
        {
          name: "virtual",
          resolveId(id) {
            if (id == "entry" || id == "$env/static/private") return id;
          },
          async load(id) {
            if (id == "entry") return js;
            if (id == "$env/static/private") return await genEnv(env);
          },
        },
      ],
      ...rolldownInputOptions,
    });
  rolldownOutputOptions ||= {};
  rolldownOutputOptions.format ||= "esm";
  rolldownOutputOptions.minify ||= "dce-only";

  const remoteModules = new Map<string, string>();
  let isBuild = false;
  let env: Record<string, string>;

  return {
    name: "vite-plugin-monoserve",
    configResolved(config) {
      isBuild = config.command == "build";
      env = loadEnv(config.mode, config.root, "");
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
      const client = code.includes("fnRaw")
        ? createRawClient(fetchURL)
        : createClient(fetchURL);
      return { code: client };
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
        const request = await toRequest(req);

        const response: Response = await Promise.resolve(createServer(id))
          .then((code) => bundle(code))
          .then((bundle) => bundle.generate(rolldownOutputOptions))
          .then((generated) => generated.output[0].code)
          .then(async (code) => {
            const path = join(
              tempLocation.startsWith("./") ? cwd() : "",
              tempLocation,
              `monoserve-${crypto.randomUUID()}.js`,
            );
            const folder = dirname(path);
            await mkdir(folder, { recursive: true });
            await writeFile(path, code);
            const { default: handler } = await import(path);

            const response = await handler(request);

            await rm(path);
            return response;
          });

        await sendResponse(res, response);
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
        Array.from(remoteModules.entries()).map(([hash, id]) =>
          Promise.resolve(createServer(id))
            .then((code) => bundle(code))
            .then((bundle) =>
              bundle.write({
                ...rolldownOutputOptions,
                file: `${functionsDir}/${hash}.js`,
              }),
            ),
        ),
      );
    },
  };
};
