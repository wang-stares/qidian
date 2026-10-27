import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const version = readFileSync(resolve(process.cwd(), "VERSION"), "utf8").trim();
const buildDate = new Date().toISOString().slice(0, 10);

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_BUILD_DATE__: JSON.stringify(buildDate),
  },
  clearScreen: false,
  server: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "chrome105",
    minify: "esbuild",
    cssCodeSplit: false,
    sourcemap: false,
    chunkSizeWarningLimit: 600,
  },
});
