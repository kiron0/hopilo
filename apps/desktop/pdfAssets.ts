import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

// Ship the renderer's fonts, character maps and decoders with the app, never a CDN.
export function pdfAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const groups = ["cmaps", "standard_fonts", "wasm"];
  return {
    name: "offline-pdf-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = /^\/pdfjs\/(cmaps|standard_fonts|wasm)\/([a-zA-Z0-9_.-]+)$/.exec(req.url?.split("?")[0] ?? "");
        if (!match || !["GET", "HEAD"].includes(req.method ?? "")) return next();
        try {
          const data = readFileSync(join(root, match[1], match[2]));
          res.setHeader("Content-Type", match[2].endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
          res.end(req.method === "HEAD" ? undefined : data);
        } catch { res.statusCode = 404; res.end(); }
      });
    },
    generateBundle() {
      for (const group of groups) for (const file of readdirSync(join(root, group), { withFileTypes: true })) {
        if (file.isFile()) this.emitFile({ type: "asset", fileName: `pdfjs/${group}/${file.name}`, source: readFileSync(join(root, group, file.name)) });
      }
    },
  };
}
