import { build } from "vite";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname);
const out = resolve(root, "dist");
rmSync(out, { recursive: true, force: true });

for (const name of ["background", "content", "popup"]) {
  await build({
    root,
    logLevel: "warn",
    configFile: false,
    build: {
      outDir: out,
      emptyOutDir: false,
      minify: true,
      lib: { entry: resolve(root, `src/${name}.ts`), formats: ["iife"], name: `hopilo_${name}`, fileName: () => `${name}.js` },
    },
  });
}
cpSync(resolve(root, "public"), out, { recursive: true });
console.log("extension built to", out);

const ff = resolve(root, "dist-firefox");
rmSync(ff, { recursive: true, force: true });
cpSync(out, ff, { recursive: true });
const manifestPath = resolve(ff, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
delete manifest.key;
delete manifest.minimum_chrome_version;
manifest.background = { scripts: ["background.js"] };
manifest.browser_specific_settings = { gecko: { id: "hopilo@hopilo.dev", strict_min_version: "128.0" } };
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log("firefox build at", ff);
