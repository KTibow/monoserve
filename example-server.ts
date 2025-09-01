import { walk } from "jsr:@std/fs/walk";

const PORT = 8080;
const FUNCTIONS_DIR = "./functions";

const functionPromises = new Map();

for await (const entry of walk(FUNCTIONS_DIR, {
  exts: [".js"],
  includeDirs: false,
})) {
  const [_functions, _source, filename] = entry.path.split("/");
  const pathname = "/" + filename.replace(".js", "");

  functionPromises.set(pathname, import(`./${entry.path}`));
}

Deno.serve({ port: PORT }, async (request) => {
  const url = new URL(request.url);
  const modulePromise = functionPromises.get(url.pathname);

  // CORS
  const origin = request.headers.get("origin") || "";
  let headers: HeadersInit = {};
  if (/http:\/\/localhost:\d+/.test(origin)) {
    headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    };
    // Handle preflight
    if (request.method == "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers,
      });
    }
  }

  if (!modulePromise) {
    return new Response("Function not found", {
      status: 404,
      headers,
    });
  }

  const { default: run } = await modulePromise;
  const response = await run(request);

  // Attach CORS headers
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }

  return response;
});
