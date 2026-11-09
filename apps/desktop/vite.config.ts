import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { pdfAssets } from "./pdfAssets.ts";

const woff2Only = () => ({
  name: "katex-woff2-only",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!/katex[\\/]dist[\\/]katex(\.min)?\.css/.test(id)) return;
    return code.replace(/,\s*url\([^)]+\.woff\) format\("woff"\)/g, "").replace(/,\s*url\([^)]+\.ttf\) format\("truetype"\)/g, "");
  },
});

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss(), pdfAssets(), woff2Only()],
  clearScreen: false,
  build: {
    chunkSizeWarningLimit: 1600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 2 },
            { name: "tauri", test: /node_modules[\\/]@tauri-apps[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
