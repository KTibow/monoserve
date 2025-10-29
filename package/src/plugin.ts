import { loadEnv, type Connect, type Plugin } from "vite";
import { rolldown, type InputOptions, type OutputOptions } from "rolldown";
import { dirname, join } from "node:path";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { cwd } from "node:process";
import { pathToFileURL } from "node:url";
import type { ServerResponse } from "node:http";
import { genEnv } from "./gen-env";

const importFile = (path) => import(pathToFileURL(path).href);
const getHash = async (input: string) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 10);
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
const createWebSocketClient = (url: string) =>
  `
export default function() {
  return new WebSocket(${JSON.stringify(url)});
}
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

  const init: RequestInit = {
    method,
    headers,
  };
  if (method != "GET" && method != "HEAD") {
    init.body = req;
    init.duplex = "half";
  }
  return new Request(url, init);
};
const sendResponse = async (res: ServerResponse, response: Response) => {
  res.statusCode = response.status;
  for (const [key, value] of response.headers) {
    res.setHeader(key, value);
  }
  res.writeHead(response.status);

  // Stream the response body back to the client
  try {
    const body = response.body;
    if (!body) return;

    for await (const value of body) {
      res.write(value);
    }
  } finally {
    res.end();
  }
};

export type Options = {
  monoserverURL: string; // set to /__monoserve/ to preview locally
  tempLocation?: string;
  env?: Record<string, string>; // if you aren't using vite
  rolldownInputOptions?: InputOptions;
  rolldownOutputOptions?: OutputOptions;
};
export const monoserve = ({
  monoserverURL,
  tempLocation = tmpdir(),
  env,
  rolldownInputOptions,
  rolldownOutputOptions,
}: Options): Plugin => {
  const functionsDir = join(process.cwd(), "functions");
  const bundle = async (path: string) =>
    rolldown({
      input: path,
      plugins: [
        {
          name: "virtual",
          resolveId(id) {
            if (id == "$env/static/private") return id;
          },
          async load(id) {
            if (id == "$env/static/private") {
              if (!env) throw new Error("No env found");
              return await genEnv(env);
            }
          },
        },
      ],
      ...rolldownInputOptions,
    });
  rolldownOutputOptions ||= {};
  rolldownOutputOptions.format ||= "esm";
  rolldownOutputOptions.minify ||= "dce-only";
  rolldownOutputOptions.inlineDynamicImports = true;

  const remoteModules = new Map<string, string>();
  const tempFiles = new Set<string>();
  let isBuild = true;

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
        : code.includes("fnWebSocket")
          ? createWebSocketClient(fetchURL)
          : createClient(fetchURL);
      return { code: client };
    },
    configureServer(server) {
      // Clean up temp files when server closes
      server.httpServer?.on("close", async () => {
        await Promise.all(
          Array.from(tempFiles).map((file) => rm(file, { force: true })),
        );
        tempFiles.clear();
      });

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/__monoserve/")) {
          return next();
        }

        const fId = req.url.replace("/__monoserve/", "");
        const id = remoteModules.get(fId);
        if (!id) {
          res.statusCode = 404;
          return res.end("Not found");
        }

        // Build a Request
        const request = await toRequest(req);

        const response: Response = await bundle(id)
          .then((bundle) => bundle.generate(rolldownOutputOptions))
          .then((generated) => generated.output[0].code)
          .then(async (code) => {
            const path = join(
              tempLocation.startsWith("./") ? cwd() : "",
              tempLocation,
              `monoserve-${await getHash(code)}.js`,
            );

            // Only write if file doesn't exist
            try {
              await access(path, constants.F_OK);
            } catch {
              const folder = dirname(path);
              await mkdir(folder, { recursive: true });
              await writeFile(path, code);
              tempFiles.add(path);
            }

            const { default: handler } = await importFile(path);
            return await handler(request);
          });

        await sendResponse(res, response);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/__monoserve/")) {
          return next();
        }

        const fId = req.url.replace("/__monoserve/", "");

        const request = await toRequest(req);

        const response: Response = await importFile(
          `${functionsDir}/${fId}.js`
        ).then(({ default: handler }) => handler(request));

        await sendResponse(res, response);
      });
    },
    async closeBundle() {
      if (!isBuild) return;

      try {
        const files = await readdir(functionsDir);
        await Promise.all(files.map((file) => rm(join(functionsDir, file))));
      } catch (e) {
        await mkdir(functionsDir, { recursive: true });
      }

      await Promise.all(
        Array.from(remoteModules.entries()).map(([hash, id]) =>
          bundle(id).then((bundle) =>
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
