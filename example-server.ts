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

  if (!modulePromise) {
    return new Response("Function not found", { status: 404 });
  }

  const { default: run } = await modulePromise;
  return await run(request);
});
