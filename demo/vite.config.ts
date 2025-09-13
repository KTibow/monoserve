import { defineConfig } from "vite";
import { monoserve } from "monoserve/plugin";

export default defineConfig({
  plugins: [monoserve({ monoserverURL: "https://benignmonoserver.fly.dev" })],
});
