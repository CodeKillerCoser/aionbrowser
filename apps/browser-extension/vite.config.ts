import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      "@browser-acp/client-core": fileURLToPath(new URL("../../packages/client-core/src/index.ts", import.meta.url)),
    },
  },
});
