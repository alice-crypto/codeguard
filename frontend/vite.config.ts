import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const backendPort = process.env.CODEGUARD_PORT ?? "8765";
const sessionToken = process.env.CODEGUARD_TOKEN ?? "";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    css: false,
  },
  build: {
    outDir: "../src/codeguard/ui/static",
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
  server: {
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
        headers: { Cookie: `codeguard_${backendPort}=${sessionToken}` },
      },
    },
  },
});
