import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Порт 18500 совпадает с devUrl в src-tauri/tauri.conf.json; см. README.md.
export default defineConfig({
  plugins: [react()],
  css: { preprocessorOptions: { scss: { quietDeps: true } } },
  server: { port: 18500, strictPort: true },
  clearScreen: false,
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
