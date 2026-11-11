import { rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

console.log("Cleaning generated Hopilo files...");

const toRemove = [
  join(root, "apps", "desktop", "dist"),
  join(root, "apps", "desktop", "src-tauri", "binaries"),
  join(root, "apps", "extension", "dist"),
  join(root, "apps", "extension", "dist-firefox"),
];

for (const dir of toRemove) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

const targetDir = join(root, "target");
if (existsSync(targetDir)) {
  const findBundleDirs = (dir) => {
    const results = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = join(dir, entry.name);
          if (entry.name === "bundle" && dir.endsWith(join("release"))) {
            results.push(fullPath);
          } else if (entry.name !== "bundle") {
            const rel = fullPath.slice(targetDir.length + 1).split(/[\\/]/);
            if (rel.length <= 3) {
              results.push(...findBundleDirs(fullPath));
            }
          }
        }
      }
    } catch {
    }
    return results;
  };

  const bundles = findBundleDirs(targetDir);
  for (const bundle of bundles) {
    rmSync(bundle, { recursive: true, force: true });
  }
}

if (process.argv.includes("--all")) {
  const res = spawnSync("cargo", ["clean"], { cwd: root, stdio: "inherit" });
  if (res.error) {
    console.error(res.error);
    process.exit(1);
  }
}

console.log("Clean complete. Dependencies, signing keys, installed app, app data preserved.");
