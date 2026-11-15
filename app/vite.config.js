import { defineConfig } from "vite";

// Порт 18500 закреплён в реестре портов корневого README.
export default defineConfig({
  server: { port: 18500, strictPort: true },
  clearScreen: false,
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
