import { loadEnv, type Connect, type Plugin } from "vite";
import { rolldown, type InputOptions, type OutputOptions } from "rolldown";
import { dirname, join, relative } from "node:path";
import { mkdir, readdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { cwd } from "node:process";
import { pathToFileURL } from "node:url";
import type { ServerResponse } from "node:http";
import { genEnv } from "./gen-env";

const importFile = (path: string) => import(pathToFileURL(path).href);
const getName = (id: string) => id.split("/").at(-1)!.split(".")[0];
const hash4 = async (input: string) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const dv = new DataView(hashBuffer);
  return dv.getUint16(0).toString(16).padStart(2, "0");
};
const addIDHash = async (name: string, id: string, root: string) => {
  const removalTarget = root.replace(/\/src$/, "").replace(/\/[^\s\/]+?$/, "/");
  const hash = await hash4(id.replace(removalTarget, ""));
  return `${name}:${hash}`;
};
const createClient = (
  url: string,
  { input, output }: { input: ModeInput; output: ModeOutput },
) => {
  let code = "";
  if (input == "manual") {
    code += `export default async function(init) {
  const res = await fetch(${JSON.stringify(url)}, {
    method: "POST",
    ...init,
  });
`;
  } else {
    code += `import { stringify, parse } from "devalue";
export default async function(arg, init) {
  const res = await fetch(${JSON.stringify(url)}, {
    method: "POST",
    body: ${input == "devalue" ? "stringify(arg)" : "JSON.stringify(arg)"},
    ...init,
  });
`;
  }
  code += `
  if (!res.ok) {
    throw new Error(await res.text());
  }
  `;
  if (output == "manual") {
    code += `
  return res;
}`;
  } else if (output == "json") {
    code += `
  return await res.json();
}`;
  } else {
    code += `
  const text = await res.text();
  return parse(text);
}`;
  }
  return code;
};
const createWebSocketClient = (url: string) =>
  `
export default function() {
  return new WebSocket(${JSON.stringify(url)});
}
`.trimStart();

const generateMonoserveImpl = (mode: Mode): string => {
  if (mode.mode == "websocket") {
    return `
export function fnWebSocket(inner) {
  if (typeof Deno == "undefined") {
    throw new Error("WebSocket not supported in this environment");
  }
  return async (req) => {
    if (req.method != "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    Promise.resolve(inner(socket, req)).catch((err) => {
      console.error("WebSocket error:", err);
      socket.close(1011, "Internal server error");
    });
    return response;
  };
}
`.trimStart();
  }

  const { input, output } = mode;
  let code = "";

  // Imports
  code += `import { parse, stringify } from "devalue";\n\n`;

  // Function signature
  code += `export function fn(${input == "manual" ? "inner" : "schema, inner"}) {\n`;

  code += `  return async (request) => {\n`;
  code += `    if (request.method != "POST") {\n`;
  code += `      return new Response("Method not allowed", { status: 405 });\n`;
  code += `    }\n\n`;
  code += `    try {\n`;

  // Input parsing
  if (input == "manual") {
    code += `      const result = await inner();\n`;
  } else {
    code += `      const text = await request.text();\n`;
    code += `      let arg = ${input == "json" ? "JSON.parse(text)" : "parse(text)"};\n\n`;
    code += `      const validated = await schema["~standard"].validate(arg);\n`;
    code += `      if (validated.issues) {\n`;
    code += `        console.warn("Noncompliant request:", validated.issues.map(i => i.message).join(", "));\n`;
    code += `        return new Response("Invalid input", { status: 400 });\n`;
    code += `      }\n`;
    code += `      arg = validated.value;\n`;
    code += `\n`;
    code += `      const result = await inner(arg);\n`;
  }

  code += `\n`;

  // Output serialization
  if (output == "manual") {
    code += `      if (!(result instanceof Response)) throw new Error("Result must be Response");\n`;
    code += `      return result;\n`;
  } else {
    code += `      return new Response(${output == "json" ? "JSON.stringify(result)" : "stringify(result)"}, {\n`;
    code += `        headers: { "content-type": "application/json" }\n`;
    code += `      });\n`;
  }

  // Error handling
  code += `    } catch (err) {\n`;
  code += `      if (err instanceof Response) return err;\n`;
  code += `      console.error(err);\n`;
  code += `      return new Response("Internal server error", { status: 500 });\n`;
  code += `    }\n`;
  code += `  };\n`;
  code += `}\n`;

  return code;
};
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

type ModeInput = "devalue" | "json" | "manual"; // manual = no input
type ModeOutput = "devalue" | "json" | "manual"; // manual = no serialization; maybe in future allow full manual (no error handling)
type Mode =
  | {
      mode: "websocket";
    }
  | {
      mode: "function";
      input: ModeInput;
      output: ModeOutput;
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
  const bundle = async (path: string, mode: Mode) =>
    rolldown({
      input: path,
      plugins: [
        {
          name: "virtual",
          resolveId(id) {
            if (id == "$env/static/private") return id;
            if (id == "monoserve") return id;
          },
          async load(id) {
            if (id == "$env/static/private") {
              if (!env) throw new Error("No env found");
              return await genEnv(env);
            }
            if (id == "monoserve") {
              return generateMonoserveImpl(mode);
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

  const loadedFunctions = new Map<
    string,
    { id: string; name: string; mode: Mode }
  >();
  const tempFiles = new Set<string>();
  let isBuild = true;
  let root = cwd();

  return {
    name: "vite-plugin-monoserve",
    config: () => ({ optimizeDeps: { exclude: ["monoserve"] } }),
    configResolved(config) {
      isBuild = config.command == "build";
      env = loadEnv(config.mode, config.root, "");
      root = config.root;
    },
    async load(id) {
      const isRemote = id.endsWith(".remote.ts") || id.endsWith(".remote.js");
      if (!isRemote) return null; // Return null to let other plugins handle it

      const code = await readFile(id, "utf-8");
      let name = getName(id);
      name = await addIDHash(name, id, root);

      let fetchURL: string, key: string;
      if (isBuild) {
        fetchURL = `${monoserverURL.replace(/\/$/, "")}/${name}`;
        key = name;
      } else {
        key = fetchURL = `/__monoserve/${relative(root, id)}`;
        name += `:${await hash4(code)}`;
      }

      if (code.includes("fnWebSocket")) {
        const mode: Mode = { mode: "websocket" };
        loadedFunctions.set(key, { id, name, mode });
        return createWebSocketClient(fetchURL);
      }

      // Tip: use "//!" syntax to note input/output modes
      let input: ModeInput = "json";
      if (
        /fn\(\s*\(\)/.test(code) ||
        /fn\(\s*async \(\)/.test(code) ||
        /fn\(\s*[a-zA-Z]+\s*\)/.test(code)
      ) {
        input = "manual";
      } else if (code.includes("monoserve input: devalue")) {
        input = "devalue";
      }

      let output: ModeOutput = "json";
      if (/(?<!throw) new Response/.test(code)) {
        output = "manual";
      } else if (code.includes("monoserve output: devalue")) {
        output = "devalue";
      }

      loadedFunctions.set(key, {
        id,
        name,
        mode: { mode: "function", input, output },
      });
      return createClient(fetchURL, { input, output });
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

        const module = loadedFunctions.get(req.url);
        if (!module) {
          res.statusCode = 404;
          return res.end("Not found");
        }
        const { id, name, mode } = module;

        // Build a Request
        const request = await toRequest(req);

        // Only write if needed (based on how path is a unique hash)
        const path = join(tempLocation, `monoserve-${name}.js`);
        if (!tempFiles.has(path)) {
          const code = await bundle(id, mode)
            .then((bundle) => bundle.generate(rolldownOutputOptions))
            .then((generated) => generated.output[0].code);
          const folder = dirname(path);
          await mkdir(folder, { recursive: true });
          await writeFile(path, code);
          tempFiles.add(path);
        }
        const { default: handler } = await importFile(path);

        await sendResponse(res, await handler(request));
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
          `${functionsDir}/${fId}.js`,
        ).then(({ default: handler }) => handler(request));

        await sendResponse(res, response);
      });
    },
    async closeBundle() {
      if (!isBuild) return;

      // Reset functions output
      try {
        const files = await readdir(functionsDir);
        await Promise.all(files.map((file) => rm(join(functionsDir, file))));
      } catch (e) {
        await mkdir(functionsDir, { recursive: true });
      }

      await Promise.all(
        Array.from(loadedFunctions.entries()).map(
          ([hash, { id: path, mode }]) =>
            bundle(path, mode).then((bundle) =>
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