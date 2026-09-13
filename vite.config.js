import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "./",
  server: { host: "127.0.0.1", port: 4173, strictPort: true, proxy: { "/api": { target: "http://127.0.0.1:3000" } } },
  preview: { host: "127.0.0.1", port: 4174, strictPort: true, proxy: { "/api": { target: "http://127.0.0.1:3000" } } },
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        board: fileURLToPath(new URL("./task-board.html", import.meta.url)),
      },
    },
  },
});
