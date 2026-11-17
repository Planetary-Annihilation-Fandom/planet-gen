import { defineConfig } from "vite";

// Порт 18500 совпадает с devUrl в src-tauri/tauri.conf.json; см. README.md.
export default defineConfig({
  server: { port: 18500, strictPort: true },
  clearScreen: false,
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
