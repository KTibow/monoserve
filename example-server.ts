import { walk } from "jsr:@std/fs/walk";

const PORT = 8080;
const FUNCTIONS_DIR = "./functions";

const functions = new Map();

for await (const entry of walk(FUNCTIONS_DIR, {
  exts: [".js"],
  includeDirs: false,
})) {
  const [_functions, _source, filename] = entry.path.split("/");
  const pathname = "/" + filename.replace(".js", "");

  functions.set(pathname, `./${entry.path}`);
}

Deno.serve({ port: PORT }, async (request) => {
  const url = new URL(request.url);
  const fn = functions.get(url.pathname);
  if (!fn) {
    return new Response("Function not found", { status: 404 });
  }

  // CORS
  const origin = request.headers.get("origin") || "";
  const originTrusted =
    /http:\/\/localhost:\d+/.test(origin) ||
    // check for your app here
    false;
  const headers: HeadersInit = originTrusted
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      }
    : {};

  if (request.method == "OPTIONS") {
    // Preflight
    return new Response(null, {
      status: 204,
      headers,
    });
  }
  if (!originTrusted && request.headers.get("upgrade") == "websocket") {
    // Security: only allow websockets from trusted origins
    return new Response("Forbidden", { status: 403 });
  }

  const { default: run } = await import(fn);
  const response = await run(request);

  if (response.status != 101) {
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
  }

  return response;
});
